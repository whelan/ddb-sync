import { DiceExtractor } from '../../dice/DiceExtractor.js';

/**
 * DDBRollInjector
 *
 * Robust replacement for the (dnd5e-v4-era) Roll.prototype.evaluate override.
 *
 * dnd5e v5 evaluates attack/damage rolls through its own BasicRoll subclasses
 * (D20Roll / DamageRoll), so patching the generic Roll.prototype.evaluate does
 * not let us reliably swap dice values. Instead we wrap the *system* roll
 * classes' evaluate, let dnd5e roll normally (advantage, modifiers, crit logic
 * all intact), then overwrite the rolled die faces with the values that came
 * from D&D Beyond, and recompute the total.
 *
 * Injection is driven by a single "pending" slot set immediately before the
 * handler calls item.use(). Roll message processing is serialized upstream, so
 * one pending value maps cleanly to the next system roll.
 */
export class DDBRollInjector {
  static _pending = null;        // { dice:[{dieType,results:[...]}], rollKind, ts }
  static _origEval = new Map();  // class -> original evaluate
  static extractor = new DiceExtractor();
  static logger = console;
  static TTL = 12000;            // ms a pending value stays valid

  /** Install the evaluate wrappers on dnd5e's roll classes. Idempotent. */
  static install() {
    const classes = [CONFIG?.Dice?.D20Roll, CONFIG?.Dice?.DamageRoll].filter(Boolean);
    if (!classes.length) {
      this.logger.warn('DDB Sync | Injector: no CONFIG.Dice roll classes found (is dnd5e active?)');
      return;
    }
    const self = this;
    for (const Cls of classes) {
      if (self._origEval.has(Cls)) continue; // already wrapped
      const orig = Cls.prototype.evaluate;
      self._origEval.set(Cls, orig);
      Cls.prototype.evaluate = async function (options = {}) {
        const result = await orig.call(this, options);
        try { self._maybeInject(this); } catch (e) { self.logger.error('DDB Sync | Injector error:', e); }
        return result;
      };
      self.logger.log(`DDB Sync | Injector wrapped ${Cls.name}.prototype.evaluate`);
    }
  }

  /** Set DDB dice to inject into the next system roll (call right before item.use()). */
  static setPending(rollData) {
    try {
      const dice = this.extractor.extractDiceResults(rollData);
      const rollKind = rollData?.rolls?.[0]?.rollKind || '';
      this._pending = { dice, rollKind, ts: Date.now() };
      this.logger.log('DDB Sync | Injector pending set:', JSON.stringify(dice), 'kind:', rollKind);
    } catch (e) {
      this.logger.error('DDB Sync | Injector setPending failed:', e);
    }
  }

  /** TEST HELPER: force the next d20 (or dN) to a fixed value. Use from console. */
  static testInject(value, faces = 20) {
    this._pending = { dice: [{ dieType: `d${faces}`, results: [value] }], rollKind: '', ts: Date.now() };
    this.logger.log(`DDB Sync | TEST inject armed: next d${faces} -> ${value}`);
    return `armed: next d${faces} -> ${value}`;
  }

  /* -------------------------------------------- */

  static _maybeInject(roll) {
    const p = this._pending;
    if (!p) return false;
    if (Date.now() - p.ts > this.TTL) { this._pending = null; return false; }

    const groups = Array.isArray(p.dice) ? p.dice : [];
    const d20Group = groups.find(g => String(g.dieType) === 'd20');
    const d20Kept = d20Group ? this._keptD20(d20Group.results, p.rollKind) : null;

    // Pool of non-d20 dice values keyed by faces (e.g. "6" -> [3,5])
    const pool = {};
    for (const g of groups) {
      if (String(g.dieType) === 'd20') continue;
      const faces = String(g.dieType).replace(/^d/i, '');
      pool[faces] = (pool[faces] || []).concat(g.results || []);
    }

    let injected = false;
    for (const term of (roll.terms || [])) {
      const faces = term?.faces;
      if (!faces || !Array.isArray(term.results) || !term.results.length) continue;

      if (faces === 20 && d20Kept != null) {
        // Set every d20 result so keep-highest/lowest still yields the DDB value.
        for (const r of term.results) r.result = d20Kept;
        injected = true;
      } else {
        const avail = pool[String(faces)];
        if (avail && avail.length) {
          for (const r of term.results) {
            if (!avail.length) break;
            r.result = avail.shift();
            injected = true;
          }
        }
      }
    }

    if (injected) {
      this._recomputeTotal(roll);
      this.logger.log('DDB Sync | Injected DDB dice; new total =', roll.total);
      this._pending = null;
    }
    return injected;
  }

  static _keptD20(values, rollKind) {
    const vals = Array.isArray(values) ? values.filter(Number.isFinite) : [];
    if (!vals.length) return null;
    if (vals.length === 1) return vals[0];
    const k = String(rollKind || '').toLowerCase();
    if (k === 'advantage') return Math.max(...vals);
    if (k === 'disadvantage') return Math.min(...vals);
    return vals[0];
  }

  static _recomputeTotal(roll) {
    try {
      if (typeof roll._evaluateTotal === 'function') { roll._total = roll._evaluateTotal(); return; }
    } catch (e) { /* fall through */ }
    try {
      roll.resetFormula?.();
      roll._total = Roll.safeEval(roll.result);
    } catch (e) { this.logger.error('DDB Sync | Injector recompute failed:', e); }
  }
}
