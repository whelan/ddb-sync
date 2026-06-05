import { IRollHandler } from '../interfaces/IRollHandler.js';
import { DDBRollInjector } from '../../core/overrides/DDBRollInjector.js';

/**
 * Attack Roll Handler
 * Responsibility: Handle attack rolls from D&D Beyond
 * SOLID: Single Responsibility - only handles attack rolls
 * Pattern: Strategy
 *
 * Constructs attack rolls directly without invoking item.use() (which shows dialogs).
 * Uses the DiceExtractor to build formulas and DDBRollInjector to swap dice values.
 */
export class AttackRollHandler extends IRollHandler {
  constructor(diceExtractor, rollBuilder) {
    super();
    this.diceExtractor = diceExtractor;
    this.rollBuilder = rollBuilder;
    this.logger = console;
  }

  canHandle(rollData) {
    const rollType = rollData.rollType || rollData.rolls?.[0]?.rollType || '';
    return rollType.toLowerCase() === 'to hit';
  }

  usesCache() {
    return true;
  }

  /**
   * Handle attack roll by constructing the roll directly with DDB dice,
   * bypassing Foundry's dialog system entirely.
   */
  async handle(actor, rollData) {
    const action = rollData.action;
    const entityId = rollData.context?.entityId || rollData.entityId;

    if (!actor) {
      this.logger.warn(`DDB Sync | No Foundry actor found for DDB character ${entityId}`);
      return;
    }

    // Find the matching item on the actor
    const item = this._findMatchingItem(actor, action);
    if (!item) {
      this.logger.warn(`DDB Sync | No matching item "${action}" found on actor ${actor.name}`);
      return;
    }

    this.logger.log(`DDB Sync | Found matching item "${item.name}" for DDB action "${action}"`);

    try {
      // Parse the DDB roll formula (includes advantage/disadvantage)
      const parsed = this.diceExtractor.parseDiceFormula(rollData);
      const formula = parsed.formula && parsed.formula !== '' ? parsed.formula : '1d20';

      // Extract DDB dice results for injection
      const ddbDiceResults = this.diceExtractor.extractDiceResults(rollData);

      // Build roll with DDB dice values (our injector will swap them in)
      DDBRollInjector.setPending(rollData);
      const roll = await this.rollBuilder.buildRollWithDDBResults(formula, ddbDiceResults);

      // Build flavor text
      let flavor = `${item.name} - Attack Roll`;
      if (parsed.isAdvantage) flavor += ' (Advantage)';
      else if (parsed.isDisadvantage) flavor += ' (Disadvantage)';

      // Post directly to chat (no dialog)
      const speaker = ChatMessage.getSpeaker({ actor });
      if (typeof roll.toMessage === 'function') {
        await roll.toMessage({ flavor, speaker });
      }

      this.logger.log(`DDB Sync | ${flavor} → Total: ${roll.total} for ${actor.name}`);
    } catch (err) {
      this.logger.error(`DDB Sync | Error handling attack roll for ${action}:`, err);
      ui.notifications.error(`Failed to roll ${action}: ${err.message}`);
    }
  }

  /**
   * Find an item on an actor that matches the DDB action name
   */
  _findMatchingItem(actor, actionName) {
    if (!actor?.items) return null;
    const normalizedAction = actionName.toLowerCase().trim();

    // Exact match
    let item = actor.items.find(i =>
      i.name.toLowerCase().trim() === normalizedAction
    );
    if (item) return item;

    // Partial match
    item = actor.items.find(i =>
      i.name.toLowerCase().includes(normalizedAction) ||
      normalizedAction.includes(i.name.toLowerCase())
    );
    return item || null;
  }
}
