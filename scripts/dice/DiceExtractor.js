import { Logger } from '../utils/Logger.js';

/**
 * Dice Extractor Service
 * Responsibility: Parse DDB dice results from roll data
 * SOLID: Single Responsibility - only extracts and transforms dice data
 */
export class DiceExtractor {
  constructor() {
    this.logger = Logger;
  }
  /**
   * Extract dice results from DDB roll data
   * @param {Object} rollData - The roll data from DDB
   * @returns {Array} Array of dice results [{dieType: 'd20', results: [8, 12, ...]}]
   */
  extractDiceResults(rollData) {
    const diceResults = [];
    if (!rollData.rolls || !Array.isArray(rollData.rolls)) {
      this.logger.warn('DDB Sync | No rolls array in rollData');
      return diceResults;
    }
    for (const roll of rollData.rolls) {
      if (roll.diceNotation?.set) {
        for (const dieSet of roll.diceNotation.set) {
          if (dieSet.dice && Array.isArray(dieSet.dice)) {
            const results = dieSet.dice.map(d => d.dieValue);
            diceResults.push({
              dieType: dieSet.dieType,
              count: dieSet.count,
              results: results
            });
          }
        }
      }
    }
    this.logger.log(`DDB Sync | Extracted ${diceResults.length} dice groups from roll data`);
    return diceResults;
  }

  /**
   * Parse dice formula from roll data, accounting for advantage/disadvantage
   * Uses Foundry syntax: 2d20kh for advantage, 2d20kl for disadvantage
   * @param {Object} rollData - The roll data from DDB
   * @returns {Object} Parsed formula info {formula: string, rollKind: string, isAdvantage: boolean, isDisadvantage: boolean}
   */
  parseDiceFormula(rollData, modifier = 0) {
    const result = {
      formula: '',
      rollKind: '',
      isAdvantage: false,
      isDisadvantage: false,
      terms: []
    };

    if (!rollData.rolls || !Array.isArray(rollData.rolls) || rollData.rolls.length === 0) {
      this.logger.warn('DDB Sync | No rolls array in rollData for formula parsing');
      return result;
    }

    const roll = rollData.rolls[0];
    result.rollKind = roll.rollKind || '';
    result.isAdvantage = result.rollKind.toLowerCase() === 'advantage';
    result.isDisadvantage = result.rollKind.toLowerCase() === 'disadvantage';

    if (!roll.diceNotation) {
      return result;
    }

    const formulaParts = [];

    // Process dice sets
    if (roll.diceNotation.set && Array.isArray(roll.diceNotation.set)) {
      for (const dieSet of roll.diceNotation.set) {
        const dieType = dieSet.dieType || 'd6';
        
        // Use the actual number of dice sent by DDB (covers both advantage 2-die and normal 1-die)
        let count = dieSet.dice?.length || dieSet.count || 1;

        // Build the dice term with Foundry syntax for advantage/disadvantage
        let term = `${count}${dieType}`;
        
        // Add keep highest/lowest modifier for d20 advantage/disadvantage rolls
        if (dieType === 'd20' && count > 1) {
          if (result.isAdvantage) {
            term += 'kh1';  // keep highest
          } else if (result.isDisadvantage) {
            term += 'kl1';  // keep lowest
          }
        }

        formulaParts.push(term);

        result.terms.push({
          count: count,
          dieType: dieType,
          modifier: dieType === 'd20' && count > 1 ? (result.isAdvantage ? 'kh1' : (result.isDisadvantage ? 'kl1' : '')) : ''
        });
      }
    }

    const constant = modifier || roll.diceNotation?.constant || 0;
    // Add constant modifier  
    if (constant >= 0) {
      formulaParts.push(`+${constant}`);
    } else {
      formulaParts.push(`${constant}`);
    }

    result.formula = formulaParts.join('');

    this.logger.log(`DDB Sync | Parsed formula: ${result.formula} (rollKind: ${result.rollKind})`);
    return result;
  }

  /**
   * Convert a Foundry roll formula to dice term specifications
   * @param {string} formula - Foundry roll formula (e.g., "1d20+5")
   * @returns {Array} Array of dice terms
   */
  parseDiceTerms(formula) {
    const diceTerms = [];
    const regex = /(\d+)d(\d+)/g;
    let match;
    while ((match = regex.exec(formula)) !== null) {
      diceTerms.push({
        number: parseInt(match[1]),
        faces: parseInt(match[2])
      });
    }
    return diceTerms;
  }
  /**
   * Get total of all dice results
   * @param {Array} diceResults - Array of dice result groups
   * @returns {number} Sum of all dice
   */
  calculateDiceTotal(diceResults) {
    return diceResults.reduce((total, group) => {
      const groupTotal = group.results.reduce((sum, result) => sum + result, 0);
      return total + groupTotal;
    }, 0);
  }
}
