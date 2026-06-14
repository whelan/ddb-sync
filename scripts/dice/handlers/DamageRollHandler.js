import { IRollHandler } from '../interfaces/IRollHandler.js';
import { RollModePolicy } from '../RollModePolicy.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Damage Roll Handler
 * Responsibility: Handle damage (and healing) rolls from D&D Beyond
 * Pattern: Strategy
 *
 * NOTE: This file was missing from ddb-sync 0.0.7 even though DDBSyncManager
 * imports and registers it, which aborted the entire module load. Recreated
 * here, modeled on the other roll handlers, to rebuild the roll with the DDB
 * dice values and post it to chat.
 */
export class DamageRollHandler extends IRollHandler {
  constructor(diceExtractor, rollBuilder) {
    super();
    this.diceExtractor = diceExtractor;
    this.rollBuilder = rollBuilder;
    this.logger = Logger;
  }

  /**
   * Check if this handler can process damage/heal rolls
   */
  canHandle(rollData) {
    const rollType = (rollData.rollType || rollData.rolls?.[0]?.rollType || '').toLowerCase();
    return rollType === 'damage' || rollType === 'heal';
  }

  usesCache() {
    return false;
  }

  /**
   * Handle damage roll by rebuilding it with the DDB dice values and posting to chat.
   */
  async handle(actor, rollData) {
    this.logger.log('DDB Sync | Handling damage roll for', actor?.name);

    const parsed = this.diceExtractor.parseDiceFormula(rollData);
    const formula = parsed.formula && parsed.formula !== '' ? parsed.formula : '0';
    const ddbDiceResults = this.diceExtractor.extractDiceResults(rollData);

    let roll;
    try {
      roll = await this.rollBuilder.buildRollWithDDBResults(formula, ddbDiceResults);
    } catch (err) {
      this.logger.error('DDB Sync | Failed to build damage roll:', err);
      return;
    }

    const rollType = (rollData.rollType || rollData.rolls?.[0]?.rollType || '').toLowerCase();
    const label = rollType === 'heal' ? 'Healing' : 'Damage';
    const action = rollData.action ? `${rollData.action} - ` : '';
    const flavor = `${action}${label}`;

    const speaker = ChatMessage.getSpeaker({ actor });
    if (typeof roll.toMessage === 'function') {
      RollModePolicy.suppressAnimation();
      await roll.toMessage({ flavor, speaker }, RollModePolicy.messageOptions(actor));
    }

    this.logger.log(`DDB Sync | ${flavor} rolled: ${roll.total} for ${actor?.name}`);
  }
}
