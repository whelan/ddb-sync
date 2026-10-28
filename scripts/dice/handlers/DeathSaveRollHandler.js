import { IRollHandler } from '../interfaces/IRollHandler.js';
import { DDBRollInjector } from '../../core/overrides/DDBRollInjector.js';
import { RollModePolicy } from '../RollModePolicy.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Death Save Roll Handler
 * Responsibility: Handle death saving throws from D&D Beyond
 * SOLID: Single Responsibility - only handles death save rolls
 * Pattern: Strategy
 *
 * DDB sends death saves as rollType "save" with action "Death", which the
 * ability-based SaveRollHandler can't map and silently dropped. This handler
 * runs dnd5e's own actor.rollDeathSave() with the DDB dice injected, so the
 * actor's death save successes/failures (and nat 1 / nat 20 effects) are
 * updated in Foundry exactly as if the roll was made there.
 */
export class DeathSaveRollHandler extends IRollHandler {
  constructor(diceExtractor, rollBuilder) {
    super();
    this.diceExtractor = diceExtractor;
    this.rollBuilder = rollBuilder;
    this.logger = Logger;
  }

  canHandle(rollData) {
    const action = String(rollData.action || '').toLowerCase();
    return action === 'death' || action.startsWith('death save');
  }

  usesCache() {
    return false;
  }

  async handle(actor, rollData) {
    this.logger.log('DDB Sync | Handling death save roll for', actor.name);

    const parsed = this.diceExtractor.parseDiceFormula(rollData);

    if (typeof actor.rollDeathSave === 'function') {
      DDBRollInjector.setPending(rollData);
      RollModePolicy.suppressAnimation();
      try {
        const roll = await this._rollSystemDeathSave(actor, parsed);
        if (roll) {
          this.logger.log(`DDB Sync | Death save rolled: ${roll.total} for ${actor.name}`);
          return;
        }
        // dnd5e declined the roll (e.g. already stable or dead) - still show the DDB result
        this.logger.warn(`DDB Sync | dnd5e declined death save for ${actor.name}; posting plain roll`);
      } finally {
        DDBRollInjector.clearPending();
      }
    }

    await this._postPlainRoll(actor, rollData, parsed);
  }

  /**
   * Call dnd5e's rollDeathSave without a configuration dialog.
   * dnd5e v4+ takes (config, dialog, message); v3 and earlier take a single options object.
   * @private
   */
  async _rollSystemDeathSave(actor, parsed) {
    const rollMode = RollModePolicy.messageOptions(actor).rollMode;
    const major = parseInt(String(game.system?.version ?? '0').split('.')[0], 10);

    if (major >= 4) {
      const message = rollMode ? { rollMode } : {};
      const result = await actor.rollDeathSave(
        { advantage: parsed.isAdvantage, disadvantage: parsed.isDisadvantage },
        { configure: false },
        message
      );
      return Array.isArray(result) ? result[0] : result;
    }

    return actor.rollDeathSave({
      fastForward: true,
      advantage: parsed.isAdvantage,
      disadvantage: parsed.isDisadvantage,
      ...(rollMode ? { rollMode } : {})
    });
  }

  /** @private */
  async _postPlainRoll(actor, rollData, parsed) {
    const formula = parsed.formula || '1d20';
    const ddbDiceResults = this.diceExtractor.extractDiceResults(rollData);
    const roll = await this.rollBuilder.buildRollWithDDBResults(formula, ddbDiceResults);

    let flavor = 'Death Saving Throw';
    if (parsed.isAdvantage) flavor += ' (Advantage)';
    else if (parsed.isDisadvantage) flavor += ' (Disadvantage)';

    const speaker = ChatMessage.getSpeaker({ actor });
    if (typeof roll.toMessage === 'function') {
      RollModePolicy.suppressAnimation();
      await roll.toMessage({ flavor, speaker }, RollModePolicy.messageOptions(actor));
    }

    this.logger.log(`DDB Sync | ${flavor} rolled: ${roll.total} for ${actor.name}`);
  }
}
