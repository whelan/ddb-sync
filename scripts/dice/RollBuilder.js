/**
 * Roll Builder Service
 * Responsibility: Create Foundry rolls with DDB dice results
 * SOLID: Single Responsibility - only builds and evaluates rolls
 */
export class RollBuilder {
  constructor() {
    this.logger = console;
  }

  /**
   * Create a Foundry roll using a formula and substitute DDB dice results
   * @param {string} formula - Foundry's roll formula (e.g., "1d20 + 7")
   * @param {Array} ddbDiceResults - Dice results from DDB
   * @returns {Promise<Roll>} A Foundry Roll object with DDB dice substituted
   */
  async buildRollWithDDBResults(formula, ddbDiceResults) {
    try {
      const roll = new Roll(formula);
      await roll.evaluate();

      // Substitute DDB dice results into the roll
      this.substituteDDBResults(roll, ddbDiceResults);

      // Recalculate the total with the new dice values
      roll._total = roll._evaluateTotal();

      this.logger.log(`DDB Sync | Built roll with formula "${formula}", total: ${roll.total}`);
      return roll;
    } catch (err) {
      this.logger.error('DDB Sync | Error building roll:', err);
      throw err;
    }
  }

  /**
   * Create a basic Foundry roll without DDB results
   * @param {string} formula - Foundry's roll formula
   * @returns {Promise<Roll>} A Foundry Roll object
   */
  async buildBasicRoll(formula) {
    try {
      const roll = new Roll(formula);
      await roll.evaluate();
      this.logger.log(`DDB Sync | Built basic roll with formula "${formula}", total: ${roll.total}`);
      return roll;
    } catch (err) {
      this.logger.error('DDB Sync | Error building basic roll:', err);
      throw err;
    }
  }

  /**
   * Substitute DDB dice results into roll terms
   * @private
   */
  substituteDDBResults(roll, ddbDiceResults) {
    let diceIndex = 0;

    for (const term of roll.terms) {
      if (term instanceof foundry.dice.terms.Die) {
        const ddbDice = ddbDiceResults[diceIndex];
        ddbDice.results.sort((a, b) => a - b); // Sort DDB results ascending
        term.results.sort((a, b) => a.result - b.result); // Sort Foundry results ascending

        if (ddbDice && ddbDice.results) {
          // Replace the rolled results with DDB results
          for (let i = 0; i < term.results.length && i < ddbDice.results.length; i++) {
            term.results[i].result = ddbDice.results[i];
          }
          this.logger.log(`DDB Sync | Substituted ${ddbDice.dieType} results into roll`);
        }
        diceIndex++;
      }
    }
  }

  /**
   * Get the numeric sum of a roll
   * @param {Roll} roll - The Foundry roll
   * @returns {number} The numeric total
   */
  getRollTotal(roll) {
    return roll.total || roll.getTotalNumericSum();
  }

  /**
   * Format roll results for display
   * @param {Roll} roll - The Foundry roll
   * @returns {string} Formatted roll string
   */
  formatRoll(roll) {
    const parts = [];
    for (const term of roll.terms) {
      if (term instanceof foundry.dice.terms.Die) {
        const results = term.results.map(r => r.result).join(',');
        parts.push(`[${results}]`);
      } else if (term instanceof foundry.dice.terms.OperatorTerm) {
        parts.push(term.operator);
      } else if (term instanceof foundry.dice.terms.NumericTerm) {
        parts.push(term.number);
      }
    }
    return parts.join(' ');
  }
}
