/**
 * SpellTemplateService Tests
 *
 * Repo convention: jest (CommonJS, node env) cannot import the Foundry ES
 * modules in scripts/, so the pure helpers below are inline mirrors of
 * scripts/core/services/SpellTemplateService.js. If you change one, change both.
 */

class SpellTemplateService {
  static templateInfo(item) {
    const system = item?.system;
    if (!system) return null;
    let activities = [];
    try {
      activities = Array.from(system.activities ?? []);
    } catch {
      activities = [];
    }
    const activity = activities.find((a) => a?.target?.template?.type);
    return activity ? { activity, type: activity.target.template.type } : null;
  }

  static shouldDeleteTemplate(flag, combat, mode) {
    if (!flag?.combatId || !combat || mode === 'never') return false;
    if (flag.combatId !== combat.id) return false;
    const round = Number(combat.round) || 0;
    const turn = Number(combat.turn) || 0;
    const fRound = Number(flag.round) || 0;
    const fTurn = Number(flag.turn) || 0;
    if (mode === 'round') return round > fRound;
    if (mode === 'turn') return round > fRound || (round === fRound && turn > fTurn);
    return false;
  }
}

describe('SpellTemplateService.templateInfo', () => {
  it('finds the area on a dnd5e 6 activity', () => {
    const save = { type: 'save', target: { template: { type: 'sphere', size: '20' } } };
    const item = { system: { activities: [{ type: 'utility', target: { template: { type: '' } } }, save] } };
    expect(SpellTemplateService.templateInfo(item)).toEqual({ activity: save, type: 'sphere' });
  });

  it('accepts Map-like activity collections', () => {
    const cone = { target: { template: { type: 'cone' } } };
    const item = { system: { activities: new Map([['a', cone]]).values() } };
    expect(SpellTemplateService.templateInfo(item).type).toBe('cone');
  });

  it('ignores legacy (pre-activity) item-level targets', () => {
    expect(SpellTemplateService.templateInfo({ system: { target: { template: { type: 'line' } } } })).toBeNull();
    expect(SpellTemplateService.templateInfo({ system: { target: { type: 'cube' } } })).toBeNull();
  });

  it('returns null for spells without an area', () => {
    expect(SpellTemplateService.templateInfo({ system: { activities: [{ target: { affects: { type: 'creature' } } }] } })).toBeNull();
    expect(SpellTemplateService.templateInfo({ system: { target: { type: 'creature' } } })).toBeNull();
    expect(SpellTemplateService.templateInfo(null)).toBeNull();
  });
});

describe('SpellTemplateService.shouldDeleteTemplate', () => {
  const flag = { combatId: 'c1', round: 2, turn: 1 };
  const at = (round, turn, id = 'c1') => ({ id, round, turn });
  const del = (combat, mode, f = flag) => SpellTemplateService.shouldDeleteTemplate(f, combat, mode);

  it('never deletes in "never" mode', () => {
    expect(del(at(9, 0), 'never')).toBe(false);
  });

  it('"turn" deletes once the turn has advanced', () => {
    expect(del(at(2, 1), 'turn')).toBe(false);
    expect(del(at(2, 2), 'turn')).toBe(true);
    expect(del(at(3, 0), 'turn')).toBe(true);
  });

  it('"round" deletes once a new round has started', () => {
    expect(del(at(2, 3), 'round')).toBe(false);
    expect(del(at(3, 0), 'round')).toBe(true);
  });

  it('keeps templates when the GM rewinds', () => {
    expect(del(at(2, 0), 'turn')).toBe(false);
    expect(del(at(1, 4), 'round')).toBe(false);
  });

  it('ignores other combats and templates placed outside combat', () => {
    expect(del(at(5, 0, 'c2'), 'round')).toBe(false);
    expect(del(at(5, 0), 'round', { combatId: null, round: 0, turn: 0 })).toBe(false);
    expect(SpellTemplateService.shouldDeleteTemplate(undefined, at(5, 0), 'round')).toBe(false);
    expect(del(null, 'round')).toBe(false);
  });
});
