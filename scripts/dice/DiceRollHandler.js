import { DiceExtractor } from './DiceExtractor.js';
import { RollBuilder } from './RollBuilder.js';
import { RollStrategyDispatcher } from './RollStrategyDispatcher.js';
import { Logger } from '../utils/Logger.js';

/**
 * Dice Roll Handler - Refactored using SOLID principles
 * Responsibility: Orchestrate dice handling through specialized services
 * SOLID: Facade Pattern - delegates to services, each with single responsibility
 */
export class DiceRollHandler {
  constructor() {
    this.diceExtractor = new DiceExtractor();
    this.rollBuilder = new RollBuilder();
    this.rollStrategyDispatcher = new RollStrategyDispatcher();
    this.logger = Logger;
  }

  /**
   * Handle incoming roll from DDB
   * Routes to appropriate handler using Strategy pattern
   */
  async handleRoll(actor, rollData, diceRollMessageHandler = null) {
    this.logger.log('DDB Sync | Handling roll:', rollData);

    try {
      // Dispatch to appropriate handler
      const handled = await this.rollStrategyDispatcher.dispatch(actor, rollData, diceRollMessageHandler);
      
      if (!handled) {
        this.logger.warn('DDB Sync | No handler found for roll, falling back to generic handler');
      }
    } catch (err) {
      this.logger.error('DDB Sync | Error handling roll:', err);
      ui.notifications.error(`DDB Sync: Error processing roll - ${err.message}`);
    }
  }

  /**
   * Register a roll handler (Strategy pattern)
   * Allows adding new roll types without modifying existing code
   */
  registerRollHandler(handler) {
    this.rollStrategyDispatcher.registerHandler(handler);
  }

  /**
   * Extract dice results - delegate to DiceExtractor
   * @deprecated Use diceExtractor.extractDiceResults() directly
   */
  extractDDBDiceResults(rollData) {
    return this.diceExtractor.extractDiceResults(rollData);
  }

  /**
   * Build roll with DDB results - delegate to RollBuilder
   * @deprecated Use rollBuilder.buildRollWithDDBResults() directly
   */
  async createRollWithDDBResults(formula, ddbDiceResults) {
    return this.rollBuilder.buildRollWithDDBResults(formula, ddbDiceResults);
  }

  /**
   * Get services for direct access if needed
   */
  getServices() {
    return {
      diceExtractor: this.diceExtractor,
      rollBuilder: this.rollBuilder,
      rollStrategyDispatcher: this.rollStrategyDispatcher
    };
  }
}
