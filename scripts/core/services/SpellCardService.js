import { Logger } from '../../utils/Logger.js';
import { RollModePolicy } from '../../dice/RollModePolicy.js';

/**
 * Spell Card Service
 * Responsibility: Post a spell's item card to chat when a D&D Beyond roll belongs to a spell
 * SOLID: Single Responsibility - finds the spell and shows its card, never rolls,
 * never consumes slots or uses, never changes the actor
 *
 * DDB rolls carry the spell name in `action` and the character id in
 * `context.entityId`. A single cast usually produces several rolls (attack,
 * then damage), so cards are de-duplicated per character + spell inside a
 * short window, and every rollId is only ever looked at once. The service
 * remembers when it last announced a spell for each actor so the spell slot
 * notifier can skip its own, less informative, "spent a slot" message.
 */
export class SpellCardService {
  static MODULE_ID = 'ddb-sync';
  /** Rolls of the same spell by the same character inside this window are one cast. */
  static CAST_WINDOW_MS = 10000;
  /** How long a posted card suppresses the slot notifier's message for that actor. */
  static ANNOUNCE_WINDOW_MS = 15000;

  /**
   * @param {Object} [deps]
   * @param {{getFoundryActor: Function}} [deps.characterMapper]
   * @param {Function} [deps.now] - Clock, injectable for tests
   */
  constructor({ characterMapper = null, now = () => Date.now() } = {}) {
    this.logger = Logger;
    this.characterMapper = characterMapper;
    this.now = now;
    /** @type {Map<string, number>} cast key -> time the card was posted */
    this.lastCast = new Map();
    /** @type {Map<string, number>} rollId -> time first seen */
    this.seenRollIds = new Map();
    /** @type {Map<string, number>} Foundry actor id -> time a card was posted */
    this.lastAnnounced = new Map();
  }

  isEnabled() {
    try {
      return game.settings.get(SpellCardService.MODULE_ID, 'postSpellCards') !== false;
    } catch {
      return true;
    }
  }

  // ---------------------------------------------------------------------------
  // Pure helpers (mirrored in tests/core/services/SpellCardService.test.js)
  // ---------------------------------------------------------------------------

  /**
   * Normalize a spell or action name for comparison.
   * Lowercases, trims, collapses whitespace and unifies apostrophes.
   * @param {string} name
   * @returns {string}
   */
  static normalizeName(name) {
    return String(name ?? '')
      .toLowerCase()
      .replace(/[‘’`]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Candidate names for a DDB action: the name itself, then the name with
   * trailing DDB annotations such as " (Ritual)" or " [Concentration]" removed.
   * @param {string} action
   * @returns {string[]} Normalized, unique candidates, most specific first
   */
  static nameCandidates(action) {
    const base = SpellCardService.normalizeName(action);
    if (!base) return [];
    const stripped = base.replace(/(\s*[([][^)\]]*[)\]])+$/, '').trim();
    return [...new Set([base, stripped].filter(Boolean))];
  }

  /**
   * Find the spell among `items` whose name matches the DDB action.
   * @param {Iterable<{type: string, name: string}>} items
   * @param {string} action
   * @returns {Object|null}
   */
  static findSpell(items, action) {
    const spells = [...(items ?? [])].filter((i) => i?.type === 'spell');
    if (!spells.length) return null;
    for (const candidate of SpellCardService.nameCandidates(action)) {
      const match = spells.find((s) => SpellCardService.nameCandidates(s.name).includes(candidate));
      if (match) return match;
    }
    return null;
  }

  /**
   * Is this roll part of a cast that already got a card?
   * Mutates `lastCast` / `seenRollIds` only when it returns true (new cast)
   * or when it records a fresh rollId.
   * @param {Map<string, number>} lastCast
   * @param {Map<string, number>} seenRollIds
   * @param {string} castKey - "<entityId>|<normalized spell name>"
   * @param {string|null} rollId
   * @param {number} now
   * @param {number} windowMs
   * @returns {boolean} true if a card should be posted
   */
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

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------

  /**
   * Was a spell card posted for this Foundry actor within the announce window?
   * @param {string} actorId
   * @returns {boolean}
   */
  recentlyAnnounced(actorId) {
    const time = this.lastAnnounced.get(actorId);
    return time !== undefined && this.now() - time <= SpellCardService.ANNOUNCE_WINDOW_MS;
  }

  /**
   * Entry point from the dice roll path. Never throws.
   * @param {Object} rollData - The DDB dice/roll/fulfilled payload
   * @param {Actor} [actor] - The mapped actor, if the caller already found it
   * @returns {Promise<ChatMessage|null>}
   */
  async handleRoll(rollData, actor = null) {
    try {
      if (!this.isEnabled()) return null;
      const action = rollData?.action;
      const entityId = rollData?.context?.entityId ?? rollData?.entityId;
      if (!action || !entityId) return null;

      actor ??= this.characterMapper?.getFoundryActor?.(entityId) ?? null;
      if (!actor) return null;

      const spell = SpellCardService.findSpell(actor.items, action);
      if (!spell) return null;

      const castKey = `${entityId}|${SpellCardService.normalizeName(spell.name)}`;
      const claimed = SpellCardService.claimCast(
        this.lastCast, this.seenRollIds, castKey, rollData.rollId ?? null,
        this.now(), SpellCardService.CAST_WINDOW_MS
      );
      if (!claimed) return null;

      this.lastAnnounced.set(actor.id, this.now());
      const message = await this.postCard(actor, spell);
      this.logger.log(`DDB Sync | Posted spell card for ${spell.name} (${actor.name})`);
      return message;
    } catch (err) {
      this.logger.error('DDB Sync | Failed to post spell card:', err);
      return null;
    }
  }

  /**
   * Flags put on the card so SpellTemplateService can find actor and item.
   */
  static cardFlags(actor, spell) {
    return { [SpellCardService.MODULE_ID]: { spellCard: { actorUuid: actor.uuid, itemUuid: spell.uuid } } };
  }

  /**
   * Show the spell's card without consuming anything or rolling.
   * Prefers dnd5e's own `displayCard`, falls back to a minimal card.
   * @param {Actor} actor
   * @param {Item} spell
   * @returns {Promise<ChatMessage|null>}
   */
  async postCard(actor, spell) {
    const flags = SpellCardService.cardFlags(actor, spell);
    const options = RollModePolicy.messageOptions(actor);

    if (typeof spell.displayCard === 'function') {
      try {
        const result = await spell.displayCard({ create: false });
        // dnd5e returns plain message data with create: false ...
        if (result && typeof result === 'object' && typeof result.setFlag !== 'function' && result.content) {
          delete result.create;
          result.flags = foundry.utils.mergeObject(result.flags ?? {}, flags);
          return await ChatMessage.create(result, options);
        }
        // ... but a version that ignores the option posts the card itself.
        if (typeof result?.setFlag === 'function') {
          await result.setFlag(SpellCardService.MODULE_ID, 'spellCard', flags[SpellCardService.MODULE_ID].spellCard);
          return result;
        }
      } catch (err) {
        this.logger.warn('DDB Sync | dnd5e displayCard failed, using fallback card:', err);
      }
    }

    return ChatMessage.create({
      content: SpellCardService.fallbackContent(spell),
      speaker: ChatMessage.getSpeaker({ actor }),
      flags
    }, options);
  }

  /**
   * Minimal card: image, name, level and school, description.
   * @param {Item} spell
   * @returns {string}
   */
  static fallbackContent(spell) {
    const level = Number(spell.system?.level) || 0;
    const levelLabel = CONFIG.DND5E?.spellLevels?.[level]
      ?? (level ? `Level ${level}` : 'Cantrip');
    const school = spell.system?.school;
    const schoolLabel = CONFIG.DND5E?.spellSchools?.[school]?.label ?? CONFIG.DND5E?.spellSchools?.[school] ?? school ?? '';
    const description = spell.system?.description?.value ?? '';
    return `<div class="dnd5e2 chat-card item-card ddb-sync-spell-card">
  <header class="card-header flexrow">
    <img src="${spell.img}" alt="${spell.name}" width="36" height="36"/>
    <h3>${spell.name}</h3>
  </header>
  <p><em>${[levelLabel, typeof schoolLabel === 'string' ? schoolLabel : ''].filter(Boolean).join(' · ')}</em></p>
  <div class="card-content">${description}</div>
</div>`;
  }
}
