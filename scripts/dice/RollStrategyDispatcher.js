/**
 * Roll Strategy Dispatcher
 * Responsibility: Route rolls to appropriate handlers using Strategy pattern
 * SOLID: Single Responsibility - only routes rolls; Open/Closed - add handlers without modifying
 * Pattern: Strategy - selects strategy based on roll type
 */
import { Logger } from '../utils/Logger.js';

export class RollStrategyDispatcher {
  constructor() {
    this.handlers = [];
    this.logger = Logger;
  }

  /**
   * Register a roll handler
   * @param {IRollHandler} handler - Handler implementing IRollHandler interface
   */
  registerHandler(handler) {
    if (!handler || typeof handler.canHandle !== 'function' || typeof handler.handle !== 'function') {
      throw new Error('Handler must implement IRollHandler interface');
    }
    this.handlers.push(handler);
    this.logger.log(`DDB Sync | Roll handler registered: ${handler.constructor.name}`);
  }

  /**
   * Dispatch a roll to the appropriate handler
   * @param {Actor} actor - The Foundry actor
   * @param {Object} rollData - The DDB roll data
   * @returns {Promise<boolean>} - True if handled, false if no handler found
   */
  async dispatch(actor, rollData, diceRollMessageHandler = null) {
    for (const handler of this.handlers) {
      if (handler.canHandle(rollData)) {
        try {
          if (handler.usesCache() && diceRollMessageHandler) {
            this.logger.log(`DDB Sync | Caching roll for handler ${handler.constructor.name}`);
            diceRollMessageHandler.cacheRollForHandler(rollData, handler);
          }

          this.logger.log(`DDB Sync | Dispatching to ${handler.constructor.name}`);
          await handler.handle(actor, rollData);
          return true;
        } catch (err) {
          this.logger.error(`DDB Sync | Handler ${handler.constructor.name} threw error:`, err);
          throw err;
        }
      }
    }

    this.logger.warn('DDB Sync | No handler found for roll type');
    return false;
  }

  /**
   * Get all registered handlers
   * @returns {Array<IRollHandler>}
   */
  getHandlers() {
    return [...this.handlers];
  }

  /**
   * Clear all handlers
   */
  clear() {
    this.handlers = [];
  }
}
