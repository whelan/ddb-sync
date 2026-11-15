import { Logger } from '../../utils/Logger.js';

/**
 * Spell Flavor Service
 * Responsibility: Whisper the GM a Danish read-aloud of how a spell looks in Barovia
 * whenever a player-owned character casts it
 * SOLID: Single Responsibility - reads the flavor journal and whispers, never
 * rolls, never consumes anything, never changes the actor or the journal
 *
 * Data comes from the GM-only JournalEntry "Barovia Spell Flavor", pushed from
 * the Legends of Barovia vault (`npm run spell-flavor:build`). The JSON is read
 * from `flags["ddb-sync"].spellFlavor` when present, else from the `<pre
 * data-ddb-sync="spell-flavor">` block on the page named "data" (or the first
 * text page). It is cached and re-read when any journal changes.
 *
 * Cast sources:
 * 1. D&D Beyond spell rolls: SpellCardService calls `whisper(actor, spell)`.
 * 2. Casts from the Foundry sheet: dnd5e 6 creates a chat message of type
 *    "usage" for every activity use (Activity#_createUsageMessage). The active
 *    GM sees it in `createChatMessage` and resolves the item with
 *    `message.getAssociatedItem()` (system.item.uuid / flags.dnd5e.item.uuid).
 * 3. D&D Beyond casts with no roll arrive only as a spent spell slot
 *    (SpellSlotNotifier). DDB does not say which spell it was, so there is no
 *    flavor for those casts.
 *
 * Sources 1 and 2 share one per-actor + spell window, so a cast never
 * whispers twice.
 */
export class SpellFlavorService {
  static MODULE_ID = 'ddb-sync';
  static JOURNAL_NAME = 'Barovia Spell Flavor';
  static FLAG_KEY = 'spellFlavor';
  static DATA_VERSION = 1;
  /** Whispers for the same actor + spell inside this window are one cast. */
  static CAST_WINDOW_MS = 10000;
  /** dnd5e school keys -> school names used by the export's `schools` map. */
  static SCHOOLS = {
    abj: 'abjuration', con: 'conjuration', div: 'divination', enc: 'enchantment',
    evo: 'evocation', ill: 'illusion', nec: 'necromancy', trs: 'transmutation'
  };

  /**
   * @param {Object} [deps]
   * @param {Function} [deps.now] - Clock, injectable for tests
   */
  constructor({ now = () => Date.now() } = {}) {
    this.logger = Logger;
    this.now = now;
    /** @type {Object|null|undefined} parsed flavor data; undefined = not loaded yet */
    this.cache = undefined;
    /** @type {Map<string, number>} actor id|spell -> time of the last whisper */
    this.lastWhisper = new Map();
    this.missingLogged = false;
    this.invalidLogged = false;
    this.hookIds = [];
  }

  isEnabled() {
    try {
      return game.settings.get(SpellFlavorService.MODULE_ID, 'spellFlavorWhispers') !== false;
    } catch {
      return true;
    }
  }

  // ---------------------------------------------------------------------------
  // Pure helpers (mirrored in tests/core/services/SpellFlavorService.test.js)
  // ---------------------------------------------------------------------------

  /**
   * Normalize a spell name as the vault export does: lowercase, trimmed,
   * whitespace collapsed, curly quotes made straight, trailing "(…)" removed.
   * @param {string} name
   * @returns {string}
   */
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

  /**
   * Find the export's character for an actor: first word of the actor name
   * against each character's `match` list, case-insensitive.
   * @param {Object} data
   * @param {string} actorName
   * @returns {Object|null}
   */
  static characterFor(data, actorName) {
    const first = String(actorName ?? '').trim().split(/\s+/)[0]?.toLowerCase();
    if (!first) return null;
    const characters = Array.isArray(data?.characters) ? data.characters : [];
    return characters.find((c) => (Array.isArray(c?.match) ? c.match : [])
      .some((m) => String(m).toLowerCase() === first)) ?? null;
  }

  /**
   * Resolve the read-aloud for a cast: character entry, then general, then the
   * school default. A character entry without read-aloud still lends its DM
   * line and first-use state to the fallback.
   * @param {Object} data - The export JSON
   * @param {{actorName: string, spellName: string, school?: string}} cast
   * @returns {{title: string, readAloud: string, dm: string|null, firstUse: boolean,
   *   source: 'character'|'general'|'school'}|null}
   */
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

  /**
   * Claim a cast for the shared per-actor + spell window.
   * @param {Map<string, number>} lastWhisper
   * @param {string} key
   * @param {number} now
   * @param {number} windowMs
   * @returns {boolean} True when this call should whisper
   */
  static claimCast(lastWhisper, key, now, windowMs) {
    for (const [k, time] of lastWhisper) {
      if (now - time > windowMs) lastWhisper.delete(k);
    }
    const last = lastWhisper.get(key);
    if (last !== undefined && now - last <= windowMs) return false;
    lastWhisper.set(key, now);
    return true;
  }

  /**
   * Is this parsed export usable?
   * @param {*} data
   * @returns {boolean}
   */
  static isValidData(data) {
    return !!data && typeof data === 'object' && data.version === SpellFlavorService.DATA_VERSION;
  }

  /**
   * Decode the HTML entities the export uses (fallback when no DOM is around).
   * @param {string} text
   * @returns {string}
   */
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

  /**
   * Text of the `<pre data-ddb-sync="spell-flavor">` block, without a DOM.
   * @param {string} html
   * @returns {string|null}
   */
  static extractPreText(html) {
    const match = /<pre\b[^>]*data-ddb-sync=["']spell-flavor["'][^>]*>([\s\S]*?)<\/pre>/i.exec(String(html ?? ''));
    if (!match) return null;
    return SpellFlavorService.decodeEntities(match[1].replace(/<[^>]+>/g, ''));
  }

  /**
   * Escape text for HTML content and attributes.
   * @param {string} text
   * @returns {string}
   */
  static escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Whisper content: header, read-aloud box, DM line, first-use note.
   * @param {{spellName: string, actorName: string, flavor: Object}} args
   * @returns {string}
   */
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

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  /** Drop the cached data; the next cast re-reads the journal. */
  invalidate() {
    this.cache = undefined;
  }

  /**
   * Parse the `<pre>` JSON from page HTML, using the browser DOM when available.
   * @param {string} html
   * @returns {Object|null}
   */
  parsePageContent(html) {
    let text = null;
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
      text = doc.querySelector('pre[data-ddb-sync="spell-flavor"]')?.textContent ?? null;
    }
    text ??= SpellFlavorService.extractPreText(html);
    if (!text) return null;
    return JSON.parse(text);
  }

  /**
   * Load (and cache) the flavor data. Null when missing or unusable.
   * @returns {Object|null}
   */
  loadData() {
    if (this.cache !== undefined) return this.cache;
    this.cache = null;
    try {
      const journal = game.journal?.getName?.(SpellFlavorService.JOURNAL_NAME);
      if (!journal) {
        if (!this.missingLogged) {
          this.logger.log(`DDB Sync | No "${SpellFlavorService.JOURNAL_NAME}" journal, spell flavor whispers are off`);
          this.missingLogged = true;
        }
        return null;
      }
      this.missingLogged = false;

      let data = journal.getFlag?.(SpellFlavorService.MODULE_ID, SpellFlavorService.FLAG_KEY) ?? null;
      if (!SpellFlavorService.isValidData(data)) {
        const pages = journal.pages;
        const page = pages?.getName?.('data') ?? pages?.find?.((p) => p.type === 'text');
        data = page ? this.parsePageContent(page.text?.content) : null;
      }
      if (!SpellFlavorService.isValidData(data)) {
        if (!this.invalidLogged) {
          this.logger.warn(`DDB Sync | "${SpellFlavorService.JOURNAL_NAME}" has no spell flavor data of version ${SpellFlavorService.DATA_VERSION}`);
          this.invalidLogged = true;
        }
        return null;
      }
      this.invalidLogged = false;
      this.cache = data;
    } catch (err) {
      this.logger.error('DDB Sync | Failed to read spell flavor journal:', err);
    }
    return this.cache;
  }

  // ---------------------------------------------------------------------------
  // Hooks and whisper
  // ---------------------------------------------------------------------------

  /** Journal cache invalidation and Foundry-side casts. Call on the GM client. */
  registerHooks() {
    const invalidate = () => this.invalidate();
    for (const hook of ['createJournalEntry', 'updateJournalEntry', 'deleteJournalEntry',
      'createJournalEntryPage', 'updateJournalEntryPage', 'deleteJournalEntryPage']) {
      this.hookIds.push([hook, Hooks.on(hook, invalidate)]);
    }
    this.hookIds.push(['createChatMessage', Hooks.on('createChatMessage', (message) => {
      this.onChatMessage(message).catch((err) => this.logger.error('DDB Sync | Spell flavor failed:', err));
    })]);
  }

  /**
   * dnd5e 6 activity usage card created (any client's cast). Only the active
   * GM whispers.
   * @param {ChatMessage} message
   * @returns {Promise<ChatMessage|null>}
   */
  async onChatMessage(message) {
    try {
      if (message?.type !== 'usage') return null;
      if (!game.users?.activeGM?.isSelf) return null;
      const item = message.getAssociatedItem?.();
      if (item?.type !== 'spell') return null;
      const actor = item.actor ?? message.getAssociatedActor?.();
      return await this.whisper(actor, item);
    } catch (err) {
      this.logger.error('DDB Sync | Spell flavor from chat message failed:', err);
      return null;
    }
  }

  /**
   * Whisper the spell's flavor to the GMs once per cast. Never throws.
   * @param {Actor} actor
   * @param {Item} spell
   * @returns {Promise<ChatMessage|null>}
   */
  async whisper(actor, spell) {
    try {
      if (!actor || !spell || !this.isEnabled()) return null;
      if (!actor.hasPlayerOwner) return null;
      const data = this.loadData();
      if (!data) return null;

      const key = `${actor.id}|${SpellFlavorService.normalizeName(spell.name)}`;
      if (!SpellFlavorService.claimCast(this.lastWhisper, key, this.now(), SpellFlavorService.CAST_WINDOW_MS)) {
        return null;
      }

      const flavor = SpellFlavorService.lookup(data, {
        actorName: actor.name, spellName: spell.name, school: spell.system?.school
      });
      if (!flavor) return null;

      const whisper = ChatMessage.getWhisperRecipients('GM').map((u) => u.id);
      if (!whisper.length) return null;
      const message = await ChatMessage.create({
        content: SpellFlavorService.buildContent({ spellName: spell.name, actorName: actor.name, flavor }),
        speaker: { alias: 'Barovia' },
        whisper,
        flags: { [SpellFlavorService.MODULE_ID]: { spellFlavor: { actorUuid: actor.uuid, itemUuid: spell.uuid, source: flavor.source } } }
      });
      this.logger.log(`DDB Sync | Whispered spell flavor for ${spell.name} (${actor.name}, ${flavor.source})`);
      return message;
    } catch (err) {
      this.logger.error('DDB Sync | Failed to whisper spell flavor:', err);
      return null;
    }
  }
}
