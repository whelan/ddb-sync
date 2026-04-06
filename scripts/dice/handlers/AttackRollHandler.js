import { IRollHandler } from '../interfaces/IRollHandler.js';

/**
 * Save Roll Handler
 * Responsibility: Handle attack rolls
 * SOLID: Single Responsibility - only handles attack rolls
 * Pattern: Strategy
 */
export class AttackRollHandler extends IRollHandler {
  constructor(diceExtractor, rollBuilder) {
    super();
    this.diceExtractor = diceExtractor;
    this.rollBuilder = rollBuilder;
    this.logger = console;
  }

  /**
   * Check if this handler can process save rolls
   */
  canHandle(rollData) {
    const rollType = rollData.rollType || rollData.rolls?.[0]?.rollType || '';
    return rollType.toLowerCase() === 'to hit';
  }

  usesCache() {
    return true;
  }

  // /**
  //  * Handle attack roll
  //  */
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
    this.logger.log(`DDB Sync | Initiating item.use() for ${item.name}`);

    await item.use();
  }

  /**
 * Find an item on an actor that matches the DDB action name
 * @param {Actor} actor - The Foundry actor
 * @param {string} actionName - The action name from DDB
 * @returns {Item|null}
 * @private
 */
  _findMatchingItem(actor, actionName) {
    if (!actor?.items) return null;

    // Normalize the action name for comparison
    const normalizedAction = actionName.toLowerCase().trim();

    // First try exact match
    let item = actor.items.find(i =>
      i.name.toLowerCase().trim() === normalizedAction
    );

    if (item) return item;

    // Try partial match (DDB might abbreviate or modify names)
    item = actor.items.find(i =>
      i.name.toLowerCase().includes(normalizedAction) ||
      normalizedAction.includes(i.name.toLowerCase())
    );

    return item || null;
  }
}
