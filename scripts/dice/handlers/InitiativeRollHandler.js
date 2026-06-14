import { IRollHandler } from '../interfaces/IRollHandler.js';
import { RollModePolicy } from '../RollModePolicy.js';

/**
 * Initiative Roll Handler
 * Responsibility: Handle initiative rolls
 * SOLID: Single Responsibility - only handles initiative rolls
 * Pattern: Strategy
 */
export class InitiativeRollHandler extends IRollHandler {
  constructor(diceExtractor, rollBuilder) {
    super();
    this.diceExtractor = diceExtractor;
    this.rollBuilder = rollBuilder;
    this.logger = console;
  }

  /**
   * Check if this handler can process initiative rolls
   */
  canHandle(rollData) {
    const rollType = rollData.action || rollData.rollType || rollData.rolls?.[0]?.rollType || '';
    return rollType.toLowerCase() === 'initiative';
  }

  usesCache() {
    return false;
  }

  /**
   * Handle initiative roll
   */
  async handle(actor, rollData) {
    this.logger.log('DDB Sync | Handling initiative roll for', actor.name);

    const token = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
    
    if (!token) {
      ui.notifications.warn(`${actor.name} has no token in the current scene`);
      return;
    }

    const initMod = actor.system.attributes?.init?.total || 0;

    const initiativeBuild = this.diceExtractor.parseDiceFormula(rollData, initMod);
    // Get Foundry's initiative formula for this actor
    const initiativeFormula = initiativeBuild.formula;
    
    // Extract DDB dice results
    const ddbDiceResults = this.diceExtractor.extractDiceResults(rollData);
    
    // Create roll with Foundry formula but DDB dice results
    const roll = await this.rollBuilder.buildRollWithDDBResults(initiativeFormula, ddbDiceResults);
    
    // Post the roll as a chat message (roll card)
    let flavor = `${actor.name} rolls for Initiative!`;
    const speaker = ChatMessage.getSpeaker({ actor });
    
    if (initiativeBuild.isAdvantage) { 
      flavor += ' (Advantage)';
    }
    else if (initiativeBuild.isDisadvantage) {
      flavor += ' (Disadvantage)';
    }

    if (typeof roll.toMessage === 'function')
      await roll.toMessage({ flavor, speaker }, RollModePolicy.messageOptions(actor));

    this.logger.log(`DDB Sync | Processed Initiative roll for ${actor.name}`);

    // Set initiative in combat tracker if available
    if (game.combat) {
      const combatant = game.combat.combatants.find(c => c.tokenId === token.id);
      if (combatant) {
        await game.combat.setInitiative(combatant.id, roll.total);
        //ui.notifications.info(`${actor.name} initiative set to ${roll.total}`);
        this.logger.log(`DDB Sync | Initiative set to ${roll.total} for ${actor.name}`);
      }
    }
  }
}
