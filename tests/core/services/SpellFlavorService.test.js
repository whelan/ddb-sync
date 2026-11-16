/**
 * SpellFlavorService Tests
 *
 * Repo convention: jest (CommonJS, node env) cannot import the Foundry ES
 * modules in scripts/, so the class below is an inline mirror of the pure
 * helpers in scripts/core/services/SpellFlavorService.js. If you change one,
 * change both.
 */

class SpellFlavorService {
  static DATA_VERSION = 1;
  static SCHOOLS = {
    abj: 'abjuration', con: 'conjuration', div: 'divination', enc: 'enchantment',
    evo: 'evocation', ill: 'illusion', nec: 'necromancy', trs: 'transmutation'
  };

  static normalizeName(name) {
    return String(name ?? '')
      .toLowerCase()
      .replace(/[‘’`]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/(\s*\([^)]*\))+$/, '')
      .trim();
  }

  static characterFor(data, actorName) {
    const first = String(actorName ?? '').trim().split(/\s+/)[0]?.toLowerCase();
    if (!first) return null;
    const characters = Array.isArray(data?.characters) ? data.characters : [];
    return characters.find((c) => (Array.isArray(c?.match) ? c.match : [])
      .some((m) => String(m).toLowerCase() === first)) ?? null;
  }

  static lookup(data, { actorName, spellName, school } = {}) {
    if (!data) return null;
    const norm = SpellFlavorService.normalizeName(spellName);
    if (!norm) return null;
    const entry = SpellFlavorService.characterFor(data, actorName)?.entries?.[norm] ?? null;
    const firstUse = !!entry && !entry.revealed;
    const dm = entry?.dm ?? null;

    if (entry?.readAloud) {
      return { title: entry.title ?? spellName, readAloud: entry.readAloud, dm, firstUse, source: 'character' };
    }
    const general = data.general?.[norm];
    if (general?.readAloud) {
      return { title: general.title ?? spellName, readAloud: general.readAloud, dm: dm ?? general.dm ?? null, firstUse, source: 'general' };
    }
    const schoolName = SpellFlavorService.SCHOOLS[school] ?? school;
    const schoolEntry = schoolName ? data.schools?.[schoolName] : null;
    if (schoolEntry?.readAloud) {
      return { title: entry?.title ?? spellName, readAloud: schoolEntry.readAloud, dm, firstUse, source: 'school' };
    }
    return null;
  }

  static claimCast(lastWhisper, key, now, windowMs) {
    for (const [k, time] of lastWhisper) {
      if (now - time > windowMs) lastWhisper.delete(k);
    }
    const last = lastWhisper.get(key);
    // Sliding window, as in SpellCardService: each roll of the cast extends it.
    lastWhisper.set(key, now);
    return !(last !== undefined && now - last <= windowMs);
  }

  static isValidData(data) {
    return !!data && typeof data === 'object' && data.version === SpellFlavorService.DATA_VERSION;
  }

  static decodeEntities(text) {
    return String(text ?? '')
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  }

  static extractPreText(html) {
    const match = /<pre\b[^>]*data-ddb-sync=["']spell-flavor["'][^>]*>([\s\S]*?)<\/pre>/i.exec(String(html ?? ''));
    if (!match) return null;
    return SpellFlavorService.decodeEntities(match[1].replace(/<[^>]+>/g, ''));
  }

  static escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  static buildContent({ spellName, actorName, flavor }) {
    const esc = SpellFlavorService.escapeHtml;
    const paragraphs = String(flavor.readAloud ?? '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
      .join('');
    const parts = [
      `<div class="ddb-sync-spell-flavor" data-source="${esc(flavor.source)}">`,
      `<header class="ddb-sync-spell-flavor-header">${esc(spellName)} · ${esc(actorName)}</header>`,
      `<blockquote class="ddb-sync-read-aloud">${paragraphs}</blockquote>`
    ];
    if (flavor.dm) parts.push(`<p class="ddb-sync-spell-flavor-dm">DM: ${esc(flavor.dm)}</p>`);
    if (flavor.firstUse) {
      parts.push('<p class="ddb-sync-spell-flavor-first">First use — narrate it and tick the Reveal log</p>');
    }
    parts.push('</div>');
    return parts.join('');
  }
}

const DATA = {
  version: 1,
  schools: {
    evocation: { readAloud: 'Ilden brænder koldt.', detail: 'cold fire' },
    abjuration: { readAloud: 'Luften strammer sig.', detail: 'tight air' }
  },
  characters: [
    { name: 'Ireena Kolyanovich', match: ['ireena'], entries: {
      'lay on hands': { title: 'Lay on Hands', readAloud: 'Varmen er rav.', readAloudDeep: null, dm: 'Amber cold.', revealed: false, deepRevealed: false },
      'shield of faith': { title: 'Shield of Faith', readAloud: 'Lyset står.', dm: null, revealed: true },
      'healing word': { title: 'Healing Word', readAloud: null, dm: 'Her own words.', revealed: false }
    } }
  ],
  general: {
    'healing word': { title: 'Healing Word', readAloud: 'Ordet bærer.', dm: null },
    'lesser restoration': { title: 'Lesser / Greater Restoration', readAloud: 'Det løfter sig.', dm: null }
  }
};

describe('normalizeName', () => {
  test('lowercases, trims, collapses whitespace', () => {
    expect(SpellFlavorService.normalizeName('  Healing   Word ')).toBe('healing word');
  });
  test('straightens curly quotes', () => {
    expect(SpellFlavorService.normalizeName('Tasha’s Hideous Laughter')).toBe("tasha's hideous laughter");
    expect(SpellFlavorService.normalizeName('“X”')).toBe('"x"');
  });
  test('removes trailing parentheses', () => {
    expect(SpellFlavorService.normalizeName('Detect Magic (Ritual)')).toBe('detect magic');
  });
  test('null-safe', () => {
    expect(SpellFlavorService.normalizeName(null)).toBe('');
  });
});

describe('characterFor', () => {
  test('matches first word case-insensitively', () => {
    expect(SpellFlavorService.characterFor(DATA, 'IREENA Kolyanovich').name).toBe('Ireena Kolyanovich');
  });
  test('no match', () => {
    expect(SpellFlavorService.characterFor(DATA, 'Ismark')).toBeNull();
    expect(SpellFlavorService.characterFor(DATA, '')).toBeNull();
  });
});

describe('lookup', () => {
  const look = (actorName, spellName, school) => SpellFlavorService.lookup(DATA, { actorName, spellName, school });

  test('character entry wins, firstUse when not revealed', () => {
    expect(look('Ireena', 'Lay on Hands', 'evo')).toEqual({
      title: 'Lay on Hands', readAloud: 'Varmen er rav.', dm: 'Amber cold.', firstUse: true, source: 'character'
    });
  });
  test('revealed entry is not first use', () => {
    expect(look('Ireena', 'Shield of Faith', 'abj').firstUse).toBe(false);
  });
  test('character entry without readAloud falls back to general, keeps DM and first use', () => {
    expect(look('Ireena', 'Healing Word', 'evo')).toEqual({
      title: 'Healing Word', readAloud: 'Ordet bærer.', dm: 'Her own words.', firstUse: true, source: 'general'
    });
  });
  test('general for another character, no first use', () => {
    const r = look('Ismark the Lesser', 'Lesser Restoration', 'abj');
    expect(r.source).toBe('general');
    expect(r.firstUse).toBe(false);
  });
  test('school default by dnd5e key', () => {
    expect(look('Ireena', 'Fireball', 'evo')).toEqual({
      title: 'Fireball', readAloud: 'Ilden brænder koldt.', dm: null, firstUse: false, source: 'school'
    });
  });
  test('school default by full name', () => {
    expect(look('Bob', 'Counterspell', 'abjuration').source).toBe('school');
  });
  test('nothing when school unknown or missing', () => {
    expect(look('Bob', 'Mystery', 'nec')).toBeNull();
    expect(look('Bob', 'Mystery', undefined)).toBeNull();
    expect(SpellFlavorService.lookup(null, { actorName: 'Bob', spellName: 'Fireball', school: 'evo' })).toBeNull();
  });
});

describe('claimCast', () => {
  test('slides: attack then damage 31 s later is one whisper with a 60 s window', () => {
    const map = new Map();
    expect(SpellFlavorService.claimCast(map, 'p|guiding bolt', 0, 60000)).toBe(true);
    expect(SpellFlavorService.claimCast(map, 'p|guiding bolt', 31000, 60000)).toBe(false);
    expect(SpellFlavorService.claimCast(map, 'p|guiding bolt', 90000, 60000)).toBe(false);
    expect(SpellFlavorService.claimCast(map, 'p|guiding bolt', 151000, 60000)).toBe(true);
  });

  test('one claim per window, then again after it', () => {
    const map = new Map();
    expect(SpellFlavorService.claimCast(map, 'a|fireball', 0, 10000)).toBe(true);
    expect(SpellFlavorService.claimCast(map, 'a|fireball', 5000, 10000)).toBe(false);
    expect(SpellFlavorService.claimCast(map, 'b|fireball', 5000, 10000)).toBe(true);
    expect(SpellFlavorService.claimCast(map, 'a|fireball', 20001, 10000)).toBe(true);
  });
});

describe('data parsing', () => {
  test('isValidData checks version 1', () => {
    expect(SpellFlavorService.isValidData({ version: 1 })).toBe(true);
    expect(SpellFlavorService.isValidData({ version: 2 })).toBe(false);
    expect(SpellFlavorService.isValidData(null)).toBe(false);
  });
  test('extractPreText unescapes the JSON block', () => {
    const json = JSON.stringify({ version: 1, general: { 'x': { title: 'A & B <c>', readAloud: 'Det "lyser"' } } });
    const escaped = SpellFlavorService.escapeHtml(json);
    const html = `<p>intro</p><pre data-ddb-sync="spell-flavor">${escaped}</pre>`;
    expect(JSON.parse(SpellFlavorService.extractPreText(html))).toEqual(JSON.parse(json));
  });
  test('extractPreText returns null without the block', () => {
    expect(SpellFlavorService.extractPreText('<pre>{}</pre>')).toBeNull();
  });
});

describe('buildContent', () => {
  const flavor = { title: 'X', readAloud: 'Første <b>afsnit</b>.\n\nAndet afsnit.', dm: 'Secret & "quoted"', firstUse: true, source: 'character' };
  test('header, escaped paragraphs, DM line, first use', () => {
    const html = SpellFlavorService.buildContent({ spellName: 'Lay on Hands', actorName: 'Ireena <K>', flavor });
    expect(html).toContain('Lay on Hands · Ireena &lt;K&gt;');
    expect(html).toContain('<blockquote class="ddb-sync-read-aloud"><p>Første &lt;b&gt;afsnit&lt;/b&gt;.</p><p>Andet afsnit.</p></blockquote>');
    expect(html).toContain('DM: Secret &amp; &quot;quoted&quot;');
    expect(html).toContain('First use — narrate it and tick the Reveal log');
  });
  test('no DM line and no first-use line when not needed', () => {
    const html = SpellFlavorService.buildContent({ spellName: 'A', actorName: 'B', flavor: { ...flavor, dm: null, firstUse: false } });
    expect(html).not.toContain('ddb-sync-spell-flavor-dm');
    expect(html).not.toContain('First use');
  });
});
