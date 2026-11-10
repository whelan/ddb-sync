/**
 * MonksTokenBarBridge Tests
 *
 * Repo convention: jest (CommonJS, node env) cannot import the Foundry ES
 * modules in scripts/, so the tables and static helpers below are an inline
 * mirror of scripts/dice/DDBRollKeys.js and
 * scripts/integrations/MonksTokenBarBridge.js. If you change one, change both.
 */

const ABILITY_MAP = Object.freeze({
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
});

const SKILL_MAP = Object.freeze({
  'acrobatics': 'acr',
  'animal handling': 'ani',
  'arcana': 'arc',
  'athletics': 'ath',
  'deception': 'dec',
  'history': 'his',
  'insight': 'ins',
  'intimidation': 'itm',
  'investigation': 'inv',
  'medicine': 'med',
  'nature': 'nat',
  'perception': 'prc',
  'performance': 'prf',
  'persuasion': 'per',
  'religion': 'rel',
  'sleight of hand': 'slt',
  'stealth': 'ste',
  'survival': 'sur'
});

class MonksTokenBarBridge {
  static RESUME_MAX_AGE_MS = 60 * 60 * 1000;

  static mapDDBRoll(rollData) {
    const rollType = String(rollData?.rolls?.[0]?.rollType || rollData?.rollType || '').toLowerCase();
    const action = String(rollData?.action || '').trim().toLowerCase();
    if (!action) return null;

    // Same detection as InitiativeRollHandler / DeathSaveRollHandler
    if (action === 'initiative' || rollType === 'initiative') return { type: 'misc', key: 'init' };
    if (action === 'death' || action.startsWith('death save')) return { type: 'misc', key: 'death' };

    if (rollType === 'save') {
      const key = ABILITY_MAP[action];
      return key ? { type: 'save', key } : null;
    }
    if (rollType === 'check') {
      if (SKILL_MAP[action]) return { type: 'skill', key: SKILL_MAP[action] };
      if (ABILITY_MAP[action]) return { type: 'ability', key: ABILITY_MAP[action] };
    }
    return null;
  }

  /**
   * Can a DDB roll answer this TokenBar request? Saves, ability and skill
   * checks, plus the dnd5e "misc" requests for death saves and initiative.
   * @param {Object} request - One of the card's requests
   * @returns {boolean}
   */
  static isAnswerable(request) {
    if (['save', 'ability', 'skill'].includes(request?.type)) return true;
    return request?.type === 'misc' && ['death', 'init'].includes(request?.key);
  }

  /**
   * TokenBar stores some request names as i18n keys (e.g. death saves).
   * @param {string} text
   * @returns {string}
   */
  static localize(text) {
    try {
      return globalThis.game?.i18n?.localize?.(text) ?? text;
    } catch {
      return text;
    }
  }

  /**
   * True for a TokenBar request-roll card (not a contested roll or XP card).
   * @param {Object} flags - The message's `flags['monks-tokenbar']`
   */
  static isRequestCard(flags) {
    return flags?.what === 'savingthrow' && Array.isArray(flags.requests);
  }

  /**
   * True if the card asks for at least one roll a DDB roll can answer.
   * @param {Object} flags - The message's `flags['monks-tokenbar']`
   */
  static hasDDBRequest(flags) {
    return MonksTokenBarBridge.isRequestCard(flags) &&
      flags.requests.some(r => MonksTokenBarBridge.isAnswerable(r));
  }

  /**
   * The card's token entries (`token<id>` flags).
   * @param {Object} flags - The message's `flags['monks-tokenbar']`
   * @returns {Object[]}
   */
  static tokenEntries(flags) {
    return Object.entries(flags || {})
      .filter(([k, v]) => k.startsWith('token') && v && typeof v === 'object' && v.id !== undefined)
      .map(([, v]) => v);
  }

  /**
   * Token entries still waiting for a result.
   * @param {Object} flags - The message's `flags['monks-tokenbar']`
   * @returns {Object[]}
   */
  static pendingTokens(flags) {
    return MonksTokenBarBridge.tokenEntries(flags).filter(t => !t.roll && !t.error);
  }

  /**
   * Find the slot a DDB roll answers: newest card first, first unrolled token
   * of the actor whose card asks for the request.
   * @param {Array<{id: string, flags: Object}>} cards - Pending cards, newest first
   * @param {string} actorId - The mapped Foundry actor id
   * @param {{type: string, key: string}} wanted - From mapDDBRoll()
   * @param {Set<string>} [claimed] - "<messageId>.<tokenId>" slots already taken
   * @returns {{messageId: string, tokenId: string, request: Object}|null}
   */
  static findMatch(cards, actorId, wanted, claimed = new Set()) {
    if (!actorId || !wanted) return null;
    for (const card of cards) {
      if (!MonksTokenBarBridge.isRequestCard(card?.flags)) continue;
      const request = card.flags.requests.find(r => r?.type === wanted.type && r?.key === wanted.key);
      if (!request) continue;
      const token = MonksTokenBarBridge.pendingTokens(card.flags)
        .find(t => t.actorid === actorId && !claimed.has(`${card.id}.${t.id}`));
      if (token) return { messageId: card.id, tokenId: token.id, request };
    }
    return null;
  }

  /**
   * Human-readable request list for the whisper, e.g. "Wisdom Saving Throw".
   * @param {Object[]} requests - The card's requests
   * @returns {string}
   */
  static requestLabel(requests) {
    return (requests || [])
      .filter(r => MonksTokenBarBridge.isAnswerable(r))
      .map(r => MonksTokenBarBridge.localize(r.name || `${r.key} ${r.type}`))
      .map(r => String(r).replace(/<[^>]*>/g, '').trim())
      .filter(Boolean)
      .join(' / ');
  }

  /**
   * Escape text for chat HTML.
   * @param {string} text
   * @returns {string}
   */
  static escape(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  /**
   * True if a card created at `timestamp` is recent enough to resume after a reload.
   * @param {number} timestamp - Message creation time (ms)
   * @param {number} now - Current time (ms)
   * @param {number} [maxAgeMs]
   */
  static isFresh(timestamp, now, maxAgeMs = MonksTokenBarBridge.RESUME_MAX_AGE_MS) {
    return Number.isFinite(timestamp) && now - timestamp <= maxAgeMs;
  }
}

const ddbRoll = (rollType, action, entityId = '123') => ({
  action,
  context: { entityId },
  rolls: [{ rollType, rollKind: '', diceNotation: { set: [{ dieType: 'd20', count: 1, dice: [{ dieValue: 12 }] }], constant: 3 } }]
});

const card = (id, requests, tokens) => {
  const flags = { what: 'savingthrow', requests, rollmode: 'roll', dc: 15 };
  for (const t of tokens) flags['token' + t.id] = t;
  return { id, flags };
};

describe('mapDDBRoll', () => {
  test('save with abbreviation or full name', () => {
    expect(MonksTokenBarBridge.mapDDBRoll(ddbRoll('save', 'WIS'))).toEqual({ type: 'save', key: 'wis' });
    expect(MonksTokenBarBridge.mapDDBRoll(ddbRoll('save', 'Dexterity'))).toEqual({ type: 'save', key: 'dex' });
  });

  test('check maps skills before abilities', () => {
    expect(MonksTokenBarBridge.mapDDBRoll(ddbRoll('check', 'Perception'))).toEqual({ type: 'skill', key: 'prc' });
    expect(MonksTokenBarBridge.mapDDBRoll(ddbRoll('check', 'Sleight of Hand'))).toEqual({ type: 'skill', key: 'slt' });
    expect(MonksTokenBarBridge.mapDDBRoll(ddbRoll('check', 'STR'))).toEqual({ type: 'ability', key: 'str' });
  });

  test('reads rollType from the envelope when rolls[] lacks it', () => {
    expect(MonksTokenBarBridge.mapDDBRoll({ action: 'CON', rollType: 'save', rolls: [{}] })).toEqual({ type: 'save', key: 'con' });
  });

  test('death saves, initiative, attacks, damage and unknown actions are not requests', () => {
    expect(MonksTokenBarBridge.mapDDBRoll(ddbRoll('to hit', 'Longsword'))).toBeNull();
    expect(MonksTokenBarBridge.mapDDBRoll(ddbRoll('damage', 'Longsword'))).toBeNull();
    expect(MonksTokenBarBridge.mapDDBRoll(ddbRoll('check', 'Thieves Tools'))).toBeNull();
    expect(MonksTokenBarBridge.mapDDBRoll({})).toBeNull();
  });
});

describe('card helpers', () => {
  const flags = card('m1', [{ type: 'save', key: 'wis', name: 'Wisdom Saving Throw' }], [
    { id: 't1', actorid: 'a1' },
    { id: 't2', actorid: 'a2', roll: { total: 9 } },
    { id: 't3', actorid: 'a3', error: true }
  ]).flags;

  test('isRequestCard only accepts savingthrow cards', () => {
    expect(MonksTokenBarBridge.isRequestCard(flags)).toBe(true);
    expect(MonksTokenBarBridge.isRequestCard({ what: 'contestedroll', requests: [] })).toBe(false);
    expect(MonksTokenBarBridge.isRequestCard(undefined)).toBe(false);
  });

  test('hasDDBRequest needs a save, check, death save or initiative request', () => {
    expect(MonksTokenBarBridge.hasDDBRequest(flags)).toBe(true);
    expect(MonksTokenBarBridge.hasDDBRequest({ what: 'savingthrow', requests: [{ type: 'dice', key: '1d6' }] })).toBe(false);
    expect(MonksTokenBarBridge.hasDDBRequest({ what: 'savingthrow', requests: [{ type: 'misc', key: 'other' }] })).toBe(false);
  });

  test('tokenEntries ignores non-token flags; pendingTokens skips rolled and errored tokens', () => {
    expect(MonksTokenBarBridge.tokenEntries(flags).map(t => t.id)).toEqual(['t1', 't2', 't3']);
    expect(MonksTokenBarBridge.pendingTokens(flags).map(t => t.id)).toEqual(['t1']);
  });

  test('requestLabel joins answerable request names and strips markup', () => {
    expect(MonksTokenBarBridge.requestLabel([
      { type: 'save', key: 'wis', name: 'Wisdom Saving Throw' },
      { type: 'skill', key: 'prc', name: '<span>Perception Check</span>' },
      { type: 'dice', key: '1d6', name: '1d6' }
    ])).toBe('Wisdom Saving Throw / Perception Check');
    expect(MonksTokenBarBridge.requestLabel([{ type: 'ability', key: 'str' }])).toBe('str ability');
    expect(MonksTokenBarBridge.requestLabel(undefined)).toBe('');
  });

  test('escape neutralises HTML', () => {
    expect(MonksTokenBarBridge.escape('<b>"A&B"</b>')).toBe('&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
  });

  test('isFresh limits resumed cards to the last hour', () => {
    const now = 10 * 60 * 60 * 1000;
    expect(MonksTokenBarBridge.isFresh(now - 1000, now)).toBe(true);
    expect(MonksTokenBarBridge.isFresh(now - 2 * 60 * 60 * 1000, now)).toBe(false);
    expect(MonksTokenBarBridge.isFresh(undefined, now)).toBe(false);
  });
});

describe('findMatch', () => {
  const wis = { type: 'save', key: 'wis', name: 'Wisdom Saving Throw' };
  const prc = { type: 'skill', key: 'prc', name: 'Perception' };

  test('matches the unrolled token of the actor on a card asking for the request', () => {
    const cards = [card('m1', [wis], [{ id: 't1', actorid: 'a1' }, { id: 't2', actorid: 'a2' }])];
    expect(MonksTokenBarBridge.findMatch(cards, 'a2', { type: 'save', key: 'wis' }))
      .toEqual({ messageId: 'm1', tokenId: 't2', request: wis });
  });

  test('no match for another request type or key', () => {
    const cards = [card('m1', [wis], [{ id: 't1', actorid: 'a1' }])];
    expect(MonksTokenBarBridge.findMatch(cards, 'a1', { type: 'save', key: 'dex' })).toBeNull();
    expect(MonksTokenBarBridge.findMatch(cards, 'a1', { type: 'ability', key: 'wis' })).toBeNull();
  });

  test('no match for an actor not on the card or already rolled in Foundry', () => {
    const cards = [card('m1', [wis], [{ id: 't1', actorid: 'a1', roll: { total: 14 } }])];
    expect(MonksTokenBarBridge.findMatch(cards, 'a1', { type: 'save', key: 'wis' })).toBeNull();
    expect(MonksTokenBarBridge.findMatch(cards, 'a9', { type: 'save', key: 'wis' })).toBeNull();
  });

  test('picks the matching request on a multi-request card', () => {
    const cards = [card('m1', [wis, prc], [{ id: 't1', actorid: 'a1' }])];
    expect(MonksTokenBarBridge.findMatch(cards, 'a1', { type: 'skill', key: 'prc' }).request).toBe(prc);
  });

  test('prefers the first (newest) card and skips claimed slots', () => {
    const cards = [
      card('new', [wis], [{ id: 't1', actorid: 'a1' }]),
      card('old', [wis], [{ id: 't1', actorid: 'a1' }])
    ];
    expect(MonksTokenBarBridge.findMatch(cards, 'a1', { type: 'save', key: 'wis' }).messageId).toBe('new');
    expect(MonksTokenBarBridge.findMatch(cards, 'a1', { type: 'save', key: 'wis' }, new Set(['new.t1'])).messageId).toBe('old');
  });

  test('two tokens of the same actor are filled one after the other', () => {
    const cards = [card('m1', [wis], [{ id: 't1', actorid: 'a1' }, { id: 't2', actorid: 'a1' }])];
    expect(MonksTokenBarBridge.findMatch(cards, 'a1', { type: 'save', key: 'wis' }, new Set(['m1.t1'])).tokenId).toBe('t2');
  });

  test('ignores non-request cards and missing input', () => {
    expect(MonksTokenBarBridge.findMatch([{ id: 'x', flags: { what: 'contestedroll' } }], 'a1', { type: 'save', key: 'wis' })).toBeNull();
    expect(MonksTokenBarBridge.findMatch([], 'a1', null)).toBeNull();
    expect(MonksTokenBarBridge.findMatch([], null, { type: 'save', key: 'wis' })).toBeNull();
  });
});

describe('death saves and initiative', () => {
  it('maps DDB death saves and initiative to TokenBar misc requests', () => {
    expect(MonksTokenBarBridge.mapDDBRoll(ddbRoll('save', 'Death'))).toEqual({ type: 'misc', key: 'death' });
    expect(MonksTokenBarBridge.mapDDBRoll(ddbRoll('save', 'Death Save'))).toEqual({ type: 'misc', key: 'death' });
    expect(MonksTokenBarBridge.mapDDBRoll(ddbRoll('roll', 'Initiative'))).toEqual({ type: 'misc', key: 'init' });
  });

  it('treats death and init requests as answerable, other misc requests not', () => {
    expect(MonksTokenBarBridge.isAnswerable({ type: 'misc', key: 'death' })).toBe(true);
    expect(MonksTokenBarBridge.isAnswerable({ type: 'misc', key: 'init' })).toBe(true);
    expect(MonksTokenBarBridge.isAnswerable({ type: 'misc', key: 'other' })).toBe(false);
    expect(MonksTokenBarBridge.isAnswerable({ type: 'tool', key: 'thief' })).toBe(false);
  });

  it('matches a DDB death save to a pending death save card', () => {
    const cards = [{
      id: 'm1',
      flags: {
        what: 'savingthrow',
        requests: [{ type: 'misc', key: 'death', name: 'MonksTokenBar.DeathSavingThrow' }],
        tokenA: { id: 'A', actorid: 'actor1' }
      }
    }];
    const wanted = MonksTokenBarBridge.mapDDBRoll(ddbRoll('save', 'Death'));
    expect(MonksTokenBarBridge.findMatch(cards, 'actor1', wanted)).toEqual({
      messageId: 'm1', tokenId: 'A', request: cards[0].flags.requests[0]
    });
    expect(MonksTokenBarBridge.hasDDBRequest(cards[0].flags)).toBe(true);
  });
});
