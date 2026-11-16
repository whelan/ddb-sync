/**
 * RollEvaluationOverride / DDBRollInjector interplay
 *
 * A system roll that ddb-sync starts from an incoming D&D Beyond roll (death
 * save, Monk's TokenBar answer) queues DDB's dice in DDBRollInjector first.
 * If the actor's dice mode is "ddb" or "manual", the evaluate override must
 * not open its prompt: the DDB roll it would wait for has already arrived,
 * so the roll would hang forever (found at the table on 2026-11-15, A5).
 *
 * Mirrors DDBRollInjector.hasPending and the prompt decision in
 * RollEvaluationOverride._handleEvaluate.
 */

class Injector {
  static _pending = null;
  static TTL = 12000;
  static now = () => Date.now();

  static setPending(dice) {
    this._pending = { dice, rollKind: '', ts: this.now() };
  }

  static hasPending() {
    const p = this._pending;
    if (!p) return false;
    if (this.now() - p.ts > this.TTL) { this._pending = null; return false; }
    return true;
  }
}

/** Which path _handleEvaluate takes for a character actor. */
function evaluatePath(diceMode, injector) {
  const mode = diceMode || 'normal';
  if (mode === 'normal' || injector.hasPending()) return 'original';
  if (mode === 'manual') return 'manual-prompt';
  if (mode === 'ddb') return 'ddb-prompt';
  return 'original';
}

describe('RollEvaluationOverride with queued DDB dice', () => {
  let clock;

  beforeEach(() => {
    clock = 1000000;
    Injector.now = () => clock;
    Injector._pending = null;
  });

  test('ddb mode prompts when nothing is queued', () => {
    expect(evaluatePath('ddb', Injector)).toBe('ddb-prompt');
  });

  test('manual mode prompts when nothing is queued', () => {
    expect(evaluatePath('manual', Injector)).toBe('manual-prompt');
  });

  test('ddb mode skips the prompt when DDB dice are queued', () => {
    Injector.setPending([{ dieType: 'd20', count: 1, results: [5] }]);
    expect(evaluatePath('ddb', Injector)).toBe('original');
  });

  test('manual mode skips the prompt when DDB dice are queued', () => {
    Injector.setPending([{ dieType: 'd20', count: 1, results: [5] }]);
    expect(evaluatePath('manual', Injector)).toBe('original');
  });

  test('normal mode is unaffected', () => {
    expect(evaluatePath('normal', Injector)).toBe('original');
    expect(evaluatePath(undefined, Injector)).toBe('original');
  });

  test('expired pending dice no longer count and are dropped', () => {
    Injector.setPending([{ dieType: 'd20', count: 1, results: [5] }]);
    clock += Injector.TTL + 1;
    expect(Injector.hasPending()).toBe(false);
    expect(Injector._pending).toBeNull();
    expect(evaluatePath('ddb', Injector)).toBe('ddb-prompt');
  });

  test('pending dice inside the TTL still count', () => {
    Injector.setPending([{ dieType: 'd20', count: 1, results: [5] }]);
    clock += Injector.TTL - 1;
    expect(Injector.hasPending()).toBe(true);
  });
});
