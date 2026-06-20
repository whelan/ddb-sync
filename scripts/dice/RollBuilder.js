/**
 * Roll Builder Service
 * Responsibility: Create Foundry rolls with DDB dice results
 * SOLID: Single Responsibility - only builds and evaluates rolls
 */
import { Logger } from '../utils/Logger.js';

export class RollBuilder {
  constructor() {
    this.logger = Logger;
  }

  /**
   * Create a Foundry roll using a formula and substitute DDB dice results
   * @param {string} formula - Foundry's roll formula (e.g., "1d20 + 7")
   * @param {Array} ddbDiceResults - Dice results from DDB
   * @returns {Promise<Roll>} A Foundry Roll object with DDB dice substituted
   */
  async buildRollWithDDBResults(formula, ddbDiceResults) {
    try {
      const roll = new Roll(formula);
      // minimize: true skips real RNG — results are overwritten by DDB values anyway
      await roll.evaluate({ minimize: true });

      // Substitute DDB dice results into the roll
      this.substituteDDBResults(roll, ddbDiceResults);

      // Recalculate the total with the new dice values
      roll._total = roll._evaluateTotal();

      this.logger.log(`DDB Sync | Built roll with formula "${formula}", total: ${roll.total}`);
      return roll;
    } catch (err) {
      this.logger.error('DDB Sync | Error building roll:', err);
      throw err;
    }
  }

  /**
   * Create a basic Foundry roll without DDB results
   * @param {string} formula - Foundry's roll formula
   * @returns {Promise<Roll>} A Foundry Roll object
   */
  async buildBasicRoll(formula) {
    try {
      const roll = new Roll(formula);
      await roll.evaluate();
      this.logger.log(`DDB Sync | Built basic roll with formula "${formula}", total: ${roll.total}`);
      return roll;
    } catch (err) {
      this.logger.error('DDB Sync | Error building basic roll:', err);
      throw err;
    }
  }

  /**
   * Substitute DDB dice results into roll terms
   * @private
   */
  substituteDDBResults(roll, ddbDiceResults) {
    let diceIndex = 0;

    for (const term of roll.terms) {
      if (term instanceof foundry.dice.terms.Die) {
        const ddbDice = ddbDiceResults[diceIndex];

        if (ddbDice && ddbDice.results) {
          // Substitute values and reset active flags before re-applying modifiers
          for (let i = 0; i < term.results.length && i < ddbDice.results.length; i++) {
            term.results[i].result = ddbDice.results[i];
            term.results[i].active = true;
            delete term.results[i].discarded;
          }

          // Re-apply kh/kl modifiers based on the actual DDB values so the correct
          // die is marked active. We cannot rely on minimize-time flag placement
          // because all minimized dice tie at 1, making the sort a no-op.
          this._reapplyKeepModifiers(term);

          this.logger.log(`DDB Sync | Substituted ${ddbDice.dieType} results into roll`);
        }
        diceIndex++;
      }
    }
  }

  /**
   * Re-apply keep-highest / keep-lowest modifiers after result substitution.
   * Reads term.modifiers (e.g. ['kh1'] or ['kl1']) and sets active/discarded flags
   * based on the current result values rather than the stale minimize-time ordering.
   * @private
   */
  _reapplyKeepModifiers(term) {
    const modifiers = term.modifiers || [];
    const khMatch = modifiers.find(m => /^kh\d+$/.test(m));
    const klMatch = modifiers.find(m => /^kl\d+$/.test(m));

    if (!khMatch && !klMatch) return;

    const keepHighest = !!khMatch;
    const keepCount = parseInt((khMatch || klMatch).replace(/^k[hl]/, ''));

    // Sort by result value (desc for kh, asc for kl) to find which indices to keep
    const indexed = term.results.map((r, i) => ({ value: r.result, index: i }));
    indexed.sort((a, b) => keepHighest ? b.value - a.value : a.value - b.value);

    const keptIndices = new Set(indexed.slice(0, keepCount).map(r => r.index));

    for (let i = 0; i < term.results.length; i++) {
      if (keptIndices.has(i)) {
        term.results[i].active = true;
        delete term.results[i].discarded;
      } else {
        term.results[i].active = false;
        term.results[i].discarded = true;
      }
    }
  }

  /**
   * Get the numeric sum of a roll
   * @param {Roll} roll - The Foundry roll
   * @returns {number} The numeric total
   */
  getRollTotal(roll) {
    return roll.total || roll.getTotalNumericSum();
  }

  /**
   * Format roll results for display
   * @param {Roll} roll - The Foundry roll
   * @returns {string} Formatted roll string
   */
  formatRoll(roll) {
    const parts = [];
    for (const term of roll.terms) {
      if (term instanceof foundry.dice.terms.Die) {
        const results = term.results.map(r => r.result).join(',');
        parts.push(`[${results}]`);
      } else if (term instanceof foundry.dice.terms.OperatorTerm) {
        parts.push(term.operator);
      } else if (term instanceof foundry.dice.terms.NumericTerm) {
        parts.push(term.number);
      }
    }
    return parts.join(' ');
  }
}
