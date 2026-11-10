import { DiceInputDialog } from '../../ui/DiceInputDialog.js';

/**
 * RollEvaluationOverride - Manages Roll.prototype.evaluate override
 * 
 * Handles injection of manual or D&D Beyond dice results into roll evaluation.
 * Encapsulates all override logic separate from main module initialization.
 * 
 * Responsibilities:
 * - Store original Roll.prototype.evaluate
 * - Override Roll.prototype.evaluate with custom logic
 * - Delegate to DiceInputDialog for manual/DDB dice prompting
 * - Substitute dice results and recalculate roll total
 */
export class RollEvaluationOverride {
  constructor(diceRollHandler, diceInputDialog = null) {
    this.diceRollHandler = diceRollHandler;
    this.diceInputDialog = diceInputDialog;
    this.originalRollEvaluate = null;
  }

  /**
   * Set the dice input dialog (for late binding/dependency injection)
   * @param {DiceInputDialog} diceInputDialog
   */
  setDiceInputDialog(diceInputDialog) {
    this.diceInputDialog = diceInputDialog;
  }

  /**
   * Initialize the Roll.prototype.evaluate override
   */
  initialize() {
    // Store original evaluate method
    this.originalRollEvaluate = Roll.prototype.evaluate;

    // Keep reference for closure
    const override = this;

    // Override Roll.prototype.evaluate with a normal function so `this` is the Roll
    Roll.prototype.evaluate = async function(options = {}) {
      return await override._handleEvaluate.call(override, this, options);
    };
  }

  /**
   * Handle roll evaluation with custom dice mode logic
   * @param {Object} options - Roll evaluation options
   * @returns {Roll} - Evaluated roll
   */
  async _handleEvaluate(roll, options = {}) {
    // Get the actor from the roll if available
    let actor = options.actor;

    if (!actor && typeof roll.data?.actorId === 'string') {
      actor = game.actors.get(roll.data.actorId);
    }

    if (!actor && typeof options.actorId === 'string') {
      actor = game.actors.get(options.actorId);
    }

    if (!actor && roll.actor) {
      actor = roll.actor;
    }

    if (!actor || !actor.type || actor.type !== 'character') {
      // Not a character actor, use normal Foundry roll
      return this.originalRollEvaluate.call(roll, options);
    }

    // Check actor's diceMode flag
    const diceMode = actor.getFlag('ddb-sync', 'diceMode') || 'normal';

    if (diceMode === 'normal') {
      // Use default Foundry behavior
      return this.originalRollEvaluate.call(roll, options);
    }

    const diceTerms = roll.terms.filter(t => t instanceof foundry.dice.terms.Die);

    if (diceMode === 'manual' && diceTerms.length > 0) {
      // Prompt for manual dice entry
      const manualResults = await this.diceInputDialog.promptForManualDice(
        roll.formula,
        diceTerms
      );

      if (manualResults) {
        // Evaluate the roll first
        await this.originalRollEvaluate.call(roll, options);

        // Then substitute the dice results
        this._substituteDiceResults(roll, manualResults);

        // Recalculate total
        roll._total = roll._evaluateTotal();
        return roll;
      }
    } else if (diceMode === 'ddb') {
      // DDB mode - wait for DDB values to be injected
      const ddbResults = await this.diceInputDialog.promptForDDBDice(
        roll.formula,
        diceTerms,
        roll.options?.rollType,
        actor,
        roll.data?.item?.name
      );

      if (ddbResults) {
        await this.originalRollEvaluate.call(roll, options);

        // Substitute the dice results
        this._substituteDiceResults(roll, ddbResults);

        // Recalculate total
        roll._total = roll._evaluateTotal();
        return roll;
      }
    }
    // Continue with normal evaluation
    return this.originalRollEvaluate.call(roll, options);
  }

  /**
   * Substitute dice results in the roll
   * @param {Array} diceResults - Array of dice result objects
   * @private
   */
  _substituteDiceResults(roll, diceResults) {
    let resultIndex = 0;
    for (const term of roll.terms) {
      if (term instanceof foundry.dice.terms.Die) {
        const customDice = diceResults[resultIndex];
        if (customDice && customDice.results) {
          customDice.results.sort((a, b) => a - b); // Sort DDB results ascending
          term.results.sort((a, b) => a.result - b.result); // Sort Foundry results ascending
          for (let i = 0; i < term.results.length && i < customDice.results.length; i++) {
            term.results[i].result = customDice.results[i];
          }
        }
        resultIndex++;
      }
    }
  }
}
