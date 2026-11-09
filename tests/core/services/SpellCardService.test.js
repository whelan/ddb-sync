/**
 * SpellCardService Tests
 *
 * Repo convention: jest (CommonJS, node env) cannot import the Foundry ES
 * modules in scripts/, so the pure helpers below are inline mirrors of
 * scripts/core/services/SpellCardService.js. If you change one, change both.
 */

class SpellCardService {
  static normalizeName(name) {
    return String(name ?? '')
      .toLowerCase()
      .replace(/[‘’`]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  static nameCandidates(action) {
    const base = SpellCardService.normalizeName(action);
    if (!base) return [];
    const stripped = base.replace(/(\s*[([][^)\]]*[)\]])+$/, '').trim();
    return [...new Set([base, stripped].filter(Boolean))];
  }

  static findSpell(items, action) {
    const spells = [...(items ?? [])].filter((i) => i?.type === 'spell');
    if (!spells.length) return null;
    for (const candidate of SpellCardService.nameCandidates(action)) {
      const match = spells.find((s) => SpellCardService.nameCandidates(s.name).includes(candidate));
      if (match) return match;
    }
    return null;
  }

  static claimCast(lastCast, seenRollIds, castKey, rollId, now, windowMs) {
    for (const map of [lastCast, seenRollIds]) {
      for (const [key, time] of map) if (now - time > windowMs) map.delete(key);
    }
    if (rollId) {
      if (seenRollIds.has(rollId)) return false;
      seenRollIds.set(rollId, now);
    }
    const last = lastCast.get(castKey);
    if (last !== undefined && now - last <= windowMs) return false;
    lastCast.set(castKey, now);
    return true;
  }
}

describe('SpellCardService name matching', () => {
  const items = [
    { type: 'weapon', name: 'Fire Bolt' },
    { type: 'spell', name: 'Fire Bolt' },
    { type: 'spell', name: 'Detect Magic' },
    { type: 'spell', name: 'Tasha’s Hideous Laughter' },
    { type: 'spell', name: 'Fireball' }
  ];

  it('normalizes case, whitespace and apostrophes', () => {
    expect(SpellCardService.normalizeName('  Tasha’s   Hideous Laughter ')).toBe("tasha's hideous laughter");
  });

  it('matches case-insensitively and only spell items', () => {
    expect(SpellCardService.findSpell(items, ' fire BOLT ')).toBe(items[1]);
  });

  it('strips DDB suffixes such as (Ritual)', () => {
    expect(SpellCardService.nameCandidates('Detect Magic (Ritual)')).toEqual(['detect magic (ritual)', 'detect magic']);
    expect(SpellCardService.findSpell(items, 'Detect Magic (Ritual)')).toBe(items[2]);
  });

  it('matches when the Foundry item carries the suffix', () => {
    const own = [{ type: 'spell', name: 'Alarm (Ritual)' }];
    expect(SpellCardService.findSpell(own, 'Alarm')).toBe(own[0]);
  });

  it('matches typographic apostrophes against plain ones', () => {
    expect(SpellCardService.findSpell(items, "Tasha's Hideous Laughter")).toBe(items[3]);
  });

  it('does no partial matching and ignores non-spells', () => {
    expect(SpellCardService.findSpell(items, 'Fire')).toBeNull();
    expect(SpellCardService.findSpell(items, 'Longsword')).toBeNull();
    expect(SpellCardService.findSpell([{ type: 'weapon', name: 'Fireball' }], 'Fireball')).toBeNull();
    expect(SpellCardService.findSpell(items, '')).toBeNull();
  });
});

describe('SpellCardService cast dedupe', () => {
  const WINDOW = 10000;
  let lastCast;
  let seen;
  const claim = (key, rollId, now) => SpellCardService.claimCast(lastCast, seen, key, rollId, now, WINDOW);

  beforeEach(() => {
    lastCast = new Map();
    seen = new Map();
  });

  it('posts one card for attack + damage of the same cast', () => {
    expect(claim('42|fire bolt', 'r1', 0)).toBe(true);
    expect(claim('42|fire bolt', 'r2', 3000)).toBe(false);
  });

  it('posts again once the window has passed', () => {
    expect(claim('42|fire bolt', 'r1', 0)).toBe(true);
    expect(claim('42|fire bolt', 'r3', WINDOW + 1)).toBe(true);
  });

  it('never handles the same rollId twice', () => {
    expect(claim('42|fire bolt', 'r1', 0)).toBe(true);
    expect(claim('42|fireball', 'r1', 5)).toBe(false);
    expect(lastCast.has('42|fireball')).toBe(false);
  });

  it('keeps characters and spells apart', () => {
    expect(claim('42|fire bolt', 'r1', 0)).toBe(true);
    expect(claim('7|fire bolt', 'r2', 10)).toBe(true);
    expect(claim('42|fireball', 'r3', 20)).toBe(true);
  });

  it('works without a rollId and prunes old entries', () => {
    expect(claim('42|fire bolt', null, 0)).toBe(true);
    expect(claim('42|fire bolt', null, 100)).toBe(false);
    claim('7|shield', 'r9', WINDOW * 5);
    expect(lastCast.has('42|fire bolt')).toBe(false);
    expect(seen.size).toBe(1);
  });
});
