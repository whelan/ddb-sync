/**
 * Roll Builder Service
 * Responsibility: Create Foundry rolls with DDB dice results injected.
 * SOLID: Single Responsibility - only builds and evaluates rolls.
 *
 * Three public builders:
 *   buildAttackRoll  — produces a dnd5e D20Roll   (for "to hit" rolls)
 *   buildDamageRoll  — produces a dnd5e DamageRoll (for damage rolls)
 *   buildRoll        — produces a plain Foundry Roll (saves, checks, initiative)
 *
 * All three follow the same pattern:
 *   1. Instantiate the correct Roll subclass with the formula + options
 *   2. evaluate() it (generates random Foundry results we will overwrite)
 *   3. substituteDDBResults() to replace Foundry's random values with DDB's actual values
 *   4. Recalculate _total
 */
export class RollBuilder {
  constructor() {
    this.logger = console;
  }

  // ── Public builders ────────────────────────────────────────────────────────

  /**
   * Build a D20Roll for an attack ("to hit") roll.
   * Options mirror what the socket trace showed for socket 42219:
   *   criticalSuccess:20, advantageMode, criticalFailure:1, configured:true, rollType:"attack"
   *
   * @param {string} formula       - Foundry roll formula, e.g. "1d20 + 2 + 2"
   * @param {Array}  ddbDiceResults - Extracted DDB dice results
   * @param {Object} parsed         - Output of DiceExtractor.parseDiceFormula()
   * @returns {Promise<Roll>}
   */
  async buildAttackRoll(formula, ddbDiceResults, parsed = {}) {
    const D20Roll = dnd5e?.dice?.D20Roll ?? Roll;

    // advantageMode: 1 = advantage, -1 = disadvantage, 0 = normal
    const advantageMode = parsed.isAdvantage ? 1 : (parsed.isDisadvantage ? -1 : 0);

    const options = {
      criticalSuccess:  20,
      criticalFailure:  1,
      advantageMode,
      elvenAccuracy:    false,
      halflingLucky:    false,
      configured:       true,
      rollType:         'attack',
    };

    return this._buildAndSubstitute(D20Roll, formula, options, ddbDiceResults);
  }

  /**
   * Build a DamageRoll for a damage roll.
   * Options mirror what the socket trace showed for socket 42223:
   *   type, types, properties, isCritical:false, configured:true, preprocessed:true
   *
   * @param {string} formula       - Foundry roll formula, e.g. "1d8"
   * @param {Array}  ddbDiceResults - Extracted DDB dice results
   * @param {Object} opts
   * @param {string} opts.damageType  - Primary damage type, e.g. "cold"
   * @param {Array}  opts.properties  - Item property tags, e.g. ["mgc"]
   * @param {boolean} [opts.isCritical=false]
   * @returns {Promise<Roll>}
   */
  async buildDamageRoll(formula, ddbDiceResults, { damageType = '', properties = [], isCritical = false } = {}) {
    const DamageRoll = dnd5e?.dice?.DamageRoll ?? Roll;

    const types = damageType ? [damageType] : [];

    const options = {
      type:         damageType,
      types,
      properties,
      isCritical,
      critical: {
        multiplyNumeric:  false,
        powerfulCritical: false,
      },
      configured:   true,
      preprocessed: true,
      rollType:     'damage',
    };

    return this._buildAndSubstitute(DamageRoll, formula, options, ddbDiceResults);
  }

  /**
   * Build a plain Roll for saves, checks, initiative, and other generic rolls.
   * This is the renamed, cleaned-up version of the old buildRollWithDDBResults().
   *
   * @param {string} formula       - Foundry roll formula
   * @param {Array}  ddbDiceResults - Extracted DDB dice results
   * @returns {Promise<Roll>}
   */
  async buildRoll(formula, ddbDiceResults) {
    return this._buildAndSubstitute(Roll, formula, {}, ddbDiceResults);
  }

  /**
   * @deprecated Use buildRoll() instead.
   * Kept for backward compatibility while other handlers are updated.
   */
  async buildRollWithDDBResults(formula, ddbDiceResults) {
    return this.buildRoll(formula, ddbDiceResults);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Core build-and-substitute logic shared by all builders.
   * @private
   */
  async _buildAndSubstitute(RollClass, formula, options, ddbDiceResults) {
    try {
      const roll = new RollClass(formula, {}, options);
      await roll.evaluate();
      this.substituteDDBResults(roll, ddbDiceResults);
      roll._total = roll._evaluateTotal();
      this.logger.log(
        `DDB Sync | RollBuilder: ${RollClass.name ?? 'Roll'} "${formula}" → ${roll.total}`
      );
      return roll;
    } catch (err) {
      this.logger.error(`DDB Sync | RollBuilder: error building roll "${formula}"`, err);
      throw err;
    }
  }

  /**
   * Substitute DDB dice results into an already-evaluated Foundry Roll.
   * Works by pairing up Die terms in the roll with DDB dice groups in order,
   * sorting both ascending, and swapping the result values.
   *
   * Sorting ascending before swapping is important: we don't care which Foundry
   * die slot gets which DDB value — we just need the total to match DDB's total,
   * and keeping both sorted means active/inactive flags for advantage/disadvantage
   * end up on the correct results.
   *
   * @param {Roll}  roll           - Evaluated Foundry Roll (mutated in place)
   * @param {Array} ddbDiceResults - [{dieType, count, results: number[]}]
   */
  substituteDDBResults(roll, ddbDiceResults) {
    if (!ddbDiceResults?.length) return;

    let diceGroupIndex = 0;

    for (const term of roll.terms) {
      if (!(term instanceof foundry.dice.terms.Die)) continue;

      const ddbGroup = ddbDiceResults[diceGroupIndex];
      if (!ddbGroup) break;

      // Sort both sides ascending so we pair smallest with smallest
      const ddbSorted     = [...ddbGroup.results].sort((a, b) => a - b);
      const foundrySlots  = [...term.results].sort((a, b) => a.result - b.result);

      for (let i = 0; i < foundrySlots.length && i < ddbSorted.length; i++) {
        foundrySlots[i].result = ddbSorted[i];
      }

      this.logger.log(
        `DDB Sync | RollBuilder: substituted ${ddbGroup.dieType} → [${ddbSorted.join(', ')}]`
      );
      diceGroupIndex++;
    }
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  getRollTotal(roll) {
    return roll.total ?? roll.getTotalNumericSum?.() ?? 0;
  }

  formatRoll(roll) {
    const parts = [];
    for (const term of roll.terms) {
      if (term instanceof foundry.dice.terms.Die) {
        parts.push(`[${term.results.map(r => r.result).join(',')}]`);
      } else if (term instanceof foundry.dice.terms.OperatorTerm) {
        parts.push(term.operator);
      } else if (term instanceof foundry.dice.terms.NumericTerm) {
        parts.push(String(term.number));
      }
    }
    return parts.join(' ');
  }
}
