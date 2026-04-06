import { IRollHandler } from '../interfaces/IRollHandler.js';

/**
 * Generic Roll Handler
 * Responsibility: Handle any roll type not covered by specific handlers
 * SOLID: Single Responsibility - fallback handler for all other rolls
 * Pattern: Strategy
 */
export class GenericRollHandler extends IRollHandler {
  constructor(diceExtractor, rollBuilder) {
    super();
    this.diceExtractor = diceExtractor;
    this.rollBuilder = rollBuilder;
    this.logger = console;
  }

  /**
   * Generic handler can handle any roll (always returns true)
   * Should be registered last as fallback
   */
  canHandle(rollData) {
    return true;
  }

  usesCache() {
    return false;
  }


  /**
   * Handle generic roll
   */
  async handle(actor, rollData) {
    const rollType = (rollData.action || '') + ' ' + (rollData.rollType || rollData.rolls?.[0]?.rollType || 'generic');
    this.logger.log(`DDB Sync | Handling ${rollType} roll for ${actor.name}`);

      // Extract DDB dice results
      const ddbDiceResults = this.diceExtractor.extractDiceResults(rollData);
      
      const buildFormula = this.diceExtractor.parseDiceFormula(rollData);
      const formula = buildFormula.formula;

      // Create roll with DDB results (or basic roll) and post a roll card to chat
      let roll;
      if (ddbDiceResults.length > 0) {
        roll = await this.rollBuilder.buildRollWithDDBResults(formula, ddbDiceResults);
      } else {
        roll = await this.rollBuilder.buildBasicRoll(formula);
      }

      // Post the roll as a chat message (roll card)
      let flavor = `${rollType}`;
      const speaker = ChatMessage.getSpeaker({ actor });
      
      if (buildFormula.isAdvantage) { 
        flavor += ' (Advantage)';
      }
      else if (buildFormula.isDisadvantage) { 
        flavor += ' (Disadvantage)';
      }

      await roll.toMessage({ flavor, speaker });

      this.logger.log(`DDB Sync | Processed ${rollType} roll for ${actor.name}`);
  }
}
