/**
 * Message Dispatcher
 * Responsibility: Route messages to appropriate handlers
 * SOLID: Open/Closed - can add new handlers without modifying this class
 * Pattern: Chain of Responsibility
 */
import { Logger } from '../../utils/Logger.js';

export class MessageDispatcher {
  constructor() {
    this.handlers = [];
    this.logger = Logger;
  }

  /**
   * Register a message handler
   * Handlers should implement IMessageHandler interface
   * @param {IMessageHandler} handler - Handler instance
   */
  registerHandler(handler) {
    if (!handler || typeof handler.canHandle !== 'function' || typeof handler.handle !== 'function') {
      throw new Error('Handler must implement IMessageHandler interface');
    }
    this.handlers.push(handler);
    this.logger.log(`DDB Sync | Handler registered: ${handler.constructor.name}`);
  }

  /**
   * Dispatch a message to the appropriate handler
   * @param {Object} message - The DDB message
   * @returns {Promise<boolean>} - True if handled, false if no handler found
   */
  async dispatch(message) {
    for (const handler of this.handlers) {
      if (handler.canHandle(message)) {
        try {
          await handler.handle(message);
          this.logger.log(`DDB Sync | Message handled by ${handler.constructor.name}`);
          return true;
        } catch (err) {
          this.logger.error(`DDB Sync | Handler ${handler.constructor.name} threw error:`, err);
          throw err;
        }
      }
    }

    this.logger.warn('DDB Sync | No handler found for message:', message.type || message.messageType);
    return false;
  }

  /**
   * Get all registered handlers
   * @returns {Array<IMessageHandler>}
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
