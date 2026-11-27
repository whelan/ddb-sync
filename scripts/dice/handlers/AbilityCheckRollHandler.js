import { IRollHandler } from '../interfaces/IRollHandler.js';
import { RollModePolicy } from '../RollModePolicy.js';
import { Logger } from '../../utils/Logger.js';
import { ABILITY_MAP, SKILL_MAP } from '../DDBRollKeys.js';

/**
 * Ability Check Roll Handler
 * Responsibility: Handle ability check rolls (including skill checks)
 * SOLID: Single Responsibility - only handles ability check rolls
 * Pattern: Strategy
 */
export class AbilityCheckRollHandler extends IRollHandler {
  constructor(diceExtractor, rollBuilder) {
    super();
    this.diceExtractor = diceExtractor;
    this.rollBuilder = rollBuilder;
    this.logger = Logger;

    // Map DDB ability names to Foundry ability abbreviations
    this.abilityMap = { ...ABILITY_MAP };

    // Map DDB skill names to Foundry skill keys
    this.skillMap = { ...SKILL_MAP };
  }

  usesCache() {
    return false;
  }

  /**
   * Check if this handler can process ability check rolls
   */
  canHandle(rollData) {
    const rollType = rollData.rollType || rollData.rolls?.[0]?.rollType || '';
    return rollType.toLowerCase() === 'check';
  }

  /**
   * Handle ability check roll
   */
  async handle(actor, rollData) {
    this.logger.log('DDB Sync | Handling ability check roll for', actor.name);

    const actionName = rollData.action?.toLowerCase() || '';
    
    // First check if it's a skill check
    const skillKey = this.skillMap[actionName];
    if (skillKey) {
      return this._handleSkillCheck(actor, rollData, skillKey, actionName);
    }

    // Otherwise treat as a raw ability check
    const abilityKey = this.abilityMap[actionName];
    if (abilityKey) {
      return this._handleAbilityCheck(actor, rollData, abilityKey);
    }

    // Tool checks (Thieves' Tools, Herbalism Kit, ...) and any other check
    // DDB names with something that is neither an ability nor a skill: post
    // DDB's own roll, using the bonus D&D Beyond computed for it.
    return this._handleOtherCheck(actor, rollData);
  }

  /**
   * Handle a check that maps to no dnd5e ability or skill, such as a tool
   * check. D&D Beyond's constant is the bonus, since the tool's proficiency
   * and ability live on the DDB sheet.
   * @private
   */
  async _handleOtherCheck(actor, rollData) {
    const checkName = String(rollData.action || '').trim() || 'Unknown';
    this.logger.log(`DDB Sync | No ability or skill for "${checkName}"; posting D&D Beyond's check as is`);

    const buildFormula = this.diceExtractor.parseDiceFormula(rollData);
    const ddbDiceResults = this.diceExtractor.extractDiceResults(rollData);
    const roll = ddbDiceResults.length > 0
      ? await this.rollBuilder.buildRollWithDDBResults(buildFormula.formula, ddbDiceResults)
      : await this.rollBuilder.buildBasicRoll(buildFormula.formula);

    let flavor = `${checkName} Check`;
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

    this.logger.log(`DDB Sync | ${flavor} rolled: ${roll.total} for ${actor.name}`);
  }

  /**
   * Handle a skill check roll
   * @private
   */
  async _handleSkillCheck(actor, rollData, skillKey, skillName) {
    // Get the skill data from the actor
    const skillData = actor.system.skills?.[skillKey];
    if (!skillData) {
      this.logger.warn(`DDB Sync | Actor ${actor.name} has no skill: ${skillKey}`);
      ui.notifications.warn(`${actor.name} has no ${skillName} skill`);
      return;
    }

    // Get the skill check modifier from Foundry actor
    const skillMod = skillData.total ?? skillData.mod ?? 0;
    
    // Build the check formula (1d20 + skill modifier)
    const buildFormula = this.diceExtractor.parseDiceFormula(rollData, skillMod);
    const checkFormula = buildFormula.formula;

    this.logger.log(`DDB Sync | Skill check formula for ${skillKey}: ${checkFormula}`);
    
    // Extract DDB dice results
    const ddbDiceResults = this.diceExtractor.extractDiceResults(rollData);
    
    // Create roll with Foundry formula but DDB dice results
    const roll = await this.rollBuilder.buildRollWithDDBResults(checkFormula, ddbDiceResults);
    
    // Get the full skill name for display
    const displayName = CONFIG.DND5E?.skills?.[skillKey]?.label || 
                        skillName.charAt(0).toUpperCase() + skillName.slice(1);
    
    let flavor = `${displayName} Check`;

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

    this.logger.log(`DDB Sync | ${flavor} rolled: ${roll.total} for ${actor.name}`);
  }

  /**
   * Handle a raw ability check roll
   * @private
   */
  async _handleAbilityCheck(actor, rollData, abilityKey) {
    // Get the ability data from the actor
    const abilityData = actor.system.abilities?.[abilityKey];
    if (!abilityData) {
      this.logger.warn(`DDB Sync | Actor ${actor.name} has no ability: ${abilityKey}`);
      ui.notifications.warn(`${actor.name} has no ${abilityKey} ability`);
      return;
    }

    // Get the ability check modifier from Foundry actor
    const checkMod = abilityData.check?.value ?? abilityData.mod ?? 0;
    
    // Build the check formula (1d20 + ability modifier)
    const buildFormula = this.diceExtractor.parseDiceFormula(rollData, checkMod);
    const checkFormula = buildFormula.formula;

    this.logger.log(`DDB Sync | Ability check formula for ${abilityKey}: ${checkFormula}`);
    
    // Extract DDB dice results
    const ddbDiceResults = this.diceExtractor.extractDiceResults(rollData);
    
    // Create roll with Foundry formula but DDB dice results
    const roll = await this.rollBuilder.buildRollWithDDBResults(checkFormula, ddbDiceResults);
    
    // Get the full ability name for display
    const abilityName = CONFIG.DND5E?.abilities?.[abilityKey]?.label || 
                        abilityKey.charAt(0).toUpperCase() + abilityKey.slice(1);
    
    let flavor = `${abilityName} Check`;
    
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

    this.logger.log(`DDB Sync | ${flavor} rolled: ${roll.total} for ${actor.name}`);
  }
}
