import { IRollHandler } from '../interfaces/IRollHandler.js';
import { RollModePolicy } from '../RollModePolicy.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Save Roll Handler
 * Responsibility: Handle ability save rolls
 * SOLID: Single Responsibility - only handles ability save rolls
 * Pattern: Strategy
 */
export class SaveRollHandler extends IRollHandler {
  constructor(diceExtractor, rollBuilder) {
    super();
    this.diceExtractor = diceExtractor;
    this.rollBuilder = rollBuilder;
    this.logger = Logger;

    // Map DDB ability names to Foundry ability abbreviations
    this.abilityMap = {
      'strength': 'str',
      'dexterity': 'dex',
      'constitution': 'con',
      'intelligence': 'int',
      'wisdom': 'wis',
      'charisma': 'cha',
      // Also support abbreviated forms from DDB
      'str': 'str',
      'dex': 'dex',
      'con': 'con',
      'int': 'int',
      'wis': 'wis',
      'cha': 'cha'
    };
  }

  /**
   * Check if this handler can process save rolls
   */
  canHandle(rollData) {
    const rollType = rollData.rollType || rollData.rolls?.[0]?.rollType || '';
    return rollType.toLowerCase() === 'save';
  }

  usesCache() {
    return false;
  }

  /**
   * Handle save roll
   */
  async handle(actor, rollData) {
    this.logger.log('DDB Sync | Handling save roll for', actor.name);

    // Get the ability from the DDB action (e.g., "Dexterity" or "dex")
    const ddbAbility = rollData.action?.toLowerCase() || '';
    const abilityKey = this.abilityMap[ddbAbility];
    
    if (!abilityKey) {
      this.logger.warn(`DDB Sync | Unknown save ability: ${rollData.action}`);
      ui.notifications.warn(`Unknown save ability: ${rollData.action}`);
      return;
    }

    // Get the ability data from the actor
    const abilityData = actor.system.abilities?.[abilityKey];
    if (!abilityData) {
      this.logger.warn(`DDB Sync | Actor ${actor.name} has no ability: ${abilityKey}`);
      ui.notifications.warn(`${actor.name} has no ${abilityKey} ability`);
      return;
    }

    // Get the save modifier from Foundry actor
    const saveMod = abilityData.save?.value ?? abilityData.mod ?? 0;
    
    const buildFormula = this.diceExtractor.parseDiceFormula(rollData, saveMod);
    const saveFormula = buildFormula.formula;

    // Build the save formula (1d20 + save modifier)
    this.logger.log(`DDB Sync | Save formula for ${abilityKey}: ${saveFormula}`);
    
    // Extract DDB dice results
    const ddbDiceResults = this.diceExtractor.extractDiceResults(rollData);
    
    // Create roll with Foundry formula but DDB dice results
    const roll = await this.rollBuilder.buildRollWithDDBResults(saveFormula, ddbDiceResults);
    
    // Get the full ability name for display
    const abilityName = CONFIG.DND5E?.abilities?.[abilityKey]?.label || 
                        abilityKey.charAt(0).toUpperCase() + abilityKey.slice(1);
    
    let flavor = `${abilityName} Saving Throw`;

    if (buildFormula.isAdvantage) { 
      flavor += ' (Advantage)';
    }
    else if (buildFormula.isDisadvantage) { 
      flavor += ' (Disadvantage)';
    }

    const speaker = ChatMessage.getSpeaker({ actor });
    if (typeof roll.toMessage === 'function') {
      RollModePolicy.suppressAnimation();
      await roll.toMessage({ flavor, speaker }, RollModePolicy.messageOptions(actor));
    }

    
    //ui.notifications.info(`${actor.name} rolled ${flavor}: ${roll.total}`);
    this.logger.log(`DDB Sync | ${flavor} rolled: ${roll.total} for ${actor.name}`);
  }
}
