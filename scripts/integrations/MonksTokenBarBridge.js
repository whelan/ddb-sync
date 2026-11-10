import { Logger } from '../utils/Logger.js';
import { ABILITY_MAP, SKILL_MAP } from '../dice/DDBRollKeys.js';
import { DDBRollInjector } from '../core/overrides/DDBRollInjector.js';

/**
 * Monk's TokenBar Bridge
 * Responsibility: Answer Monk's TokenBar "Request Roll" cards with D&D Beyond rolls
 * SOLID: Single Responsibility - only links pending TokenBar requests to DDB rolls;
 *   rolls are built by the injected DiceExtractor/RollBuilder, results are written
 *   by TokenBar's own SavingThrow.updateMessage (DC pass/fail, reveal, group result).
 *
 * Flow (GM client, active GM only):
 *  1. TokenBar posts its request card (a ChatMessage whose `flags.monks-tokenbar`
 *     has `what: 'savingthrow'`, `requests: [{type, key, name}]` and one
 *     `token<id>` entry per token). `createChatMessage` registers the card as
 *     pending and whispers every DDB-mapped actor's player owners (plus the GM)
 *     to roll the request on D&D Beyond.
 *  2. A `dice/roll/fulfilled` roll arrives. DiceRollMessageHandler offers it to
 *     tryConsume() before normal routing. The DDB `rollType`/`action` are mapped
 *     to a TokenBar request (`save`/`ability`/`skill` + dnd5e key); the newest
 *     pending card with an unrolled token of the mapped actor and that request
 *     gets a Foundry Roll built from the DDB dice, exactly as a roll from the
 *     card's own buttons would. The roll is then consumed and not posted again.
 *  3. A card stops being pending when it is deleted or every token has a
 *     result (including rolls made in Foundry through the card's buttons).
 *
 * Death saves and initiative are left to the normal handlers, which update the
 * actor's death save track and the combat tracker.
 *
 * NOTE: tests/integrations/MonksTokenBarBridge.test.js contains a mirror copy of
 * the static helpers (jest cannot import Foundry ES modules). Keep them in sync.
 */
export class MonksTokenBarBridge {
  static MODULE_ID = 'ddb-sync';
  static TOKENBAR_ID = 'monks-tokenbar';
  static SAVINGTHROW_PATH = 'modules/monks-tokenbar/apps/savingthrow.js';
  /** Cards older than this are not picked up again after a reload */
  static RESUME_MAX_AGE_MS = 60 * 60 * 1000;

  /**
   * @param {Object} options
   * @param {CharacterMapper} options.characterMapper - DDB id <-> actor mapping
   * @param {DiceExtractor} options.diceExtractor - Reads DDB dice and formula
   * @param {RollBuilder} options.rollBuilder - Builds a Foundry Roll from DDB dice
   */
  constructor({ characterMapper, diceExtractor, rollBuilder }) {
    this.logger = Logger;
    this.characterMapper = characterMapper;
    this.diceExtractor = diceExtractor;
    this.rollBuilder = rollBuilder;
    /** @type {string[]} Pending TokenBar card message ids, oldest first */
    this.pending = [];
    /** @type {Set<string>} "<messageId>.<tokenId>" slots being filled right now */
    this.claimed = new Set();
    this._savingThrowModule = null;
  }

  // ---------------------------------------------------------------------------
  // Pure helpers (mirrored in tests)
  // ---------------------------------------------------------------------------

  /**
   * Map a DDB roll to the TokenBar request it answers.
   * @param {Object} rollData - DDB dice/roll/fulfilled payload
   * @returns {{type: string, key: string}|null} null for rolls TokenBar
   *   requests are not answered with (attacks, damage, generic rolls)
   */
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

  // ---------------------------------------------------------------------------
  // Foundry integration
  // ---------------------------------------------------------------------------

  /**
   * True when TokenBar is active, the setting is on and this client is the active GM.
   */
  isActive() {
    try {
      if (!game.modules.get(MonksTokenBarBridge.TOKENBAR_ID)?.active) return false;
      if (game.settings.get(MonksTokenBarBridge.MODULE_ID, 'monksTokenBarRequests') === false) return false;
      const activeGM = game.users?.activeGM;
      return activeGM ? activeGM.isSelf : !!game.user?.isGM;
    } catch {
      return false;
    }
  }

  /**
   * Register the chat hooks that track pending cards. Call once on the GM client.
   */
  registerHooks() {
    Hooks.on('createChatMessage', (message) => this._guard('createChatMessage', () => this._onCreate(message)));
    Hooks.on('updateChatMessage', (message) => this._guard('updateChatMessage', () => this._onUpdate(message)));
    Hooks.on('deleteChatMessage', (message) => this._forget(message?.id));
    this._guard('resume', () => this._resumeOpenCards());
  }

  /**
   * Offer a DDB roll to the pending TokenBar cards.
   * @param {Object} rollData - DDB dice/roll/fulfilled payload
   * @returns {Promise<boolean>} true if the roll was filled into a card and
   *   must not be posted by the normal roll handlers
   */
  async tryConsume(rollData) {
    if (!this.pending.length || !this.isActive()) return false;

    const wanted = MonksTokenBarBridge.mapDDBRoll(rollData);
    if (!wanted) return false;

    const entityId = rollData?.context?.entityId || rollData?.entityId;
    const actor = entityId ? this.characterMapper?.getFoundryActor(entityId) : null;
    if (!actor) return false;

    const cards = [...this.pending].reverse()
      .map(id => game.messages.get(id))
      .filter(Boolean)
      .map(m => ({ id: m.id, flags: m.flags?.[MonksTokenBarBridge.TOKENBAR_ID] }));
    const match = MonksTokenBarBridge.findMatch(cards, actor.id, wanted, this.claimed);
    if (!match) return false;

    const slot = `${match.messageId}.${match.tokenId}`;
    this.claimed.add(slot);
    try {
      const roll = await this._buildRoll(actor, wanted, rollData);
      const { SavingThrow } = await this._loadSavingThrow();
      const message = game.messages.get(match.messageId);
      if (!message || !SavingThrow?.updateMessage) throw new Error('TokenBar card or SavingThrow API unavailable');

      // Same shape TokenBar's own 'setRolls' socket path passes to updateMessage
      await SavingThrow.updateMessage(
        [{ id: match.tokenId, roll, request: match.request, finish: null, reveal: true }],
        message,
        true
      );
      if (wanted.type === 'misc' && wanted.key === 'init') await this._setInitiative(actor, roll.total);
      this.logger.log(`DDB Sync | Filled DDB ${wanted.type} ${wanted.key} for ${actor.name} into TokenBar card ${match.messageId}`);
      return true;
    } catch (err) {
      this.logger.error('DDB Sync | Could not fill DDB roll into TokenBar card, posting it normally:', err);
      return false;
    } finally {
      this.claimed.delete(slot);
    }
  }

  /**
   * Build the Foundry Roll the same way the save/check handlers do: Foundry's
   * modifier for the request, DDB's dice (kept/dropped for adv/dis).
   * @private
   */
  async _buildRoll(actor, wanted, rollData) {
    if (wanted.type === 'misc' && wanted.key === 'death') {
      const systemRoll = await this._systemDeathSave(actor, rollData);
      if (systemRoll) return systemRoll;
    }
    const ability = actor.system?.abilities?.[wanted.key];
    let modifier = 0;
    if (wanted.type === 'save') modifier = ability?.save?.value ?? ability?.mod ?? 0;
    else if (wanted.type === 'ability') modifier = ability?.check?.value ?? ability?.mod ?? 0;
    else if (wanted.type === 'misc' && wanted.key === 'init') modifier = actor.system?.attributes?.init?.total ?? 0;
    else if (wanted.type === 'skill') {
      const skill = actor.system?.skills?.[wanted.key];
      modifier = skill?.total ?? skill?.mod ?? 0;
    }
    const { formula } = this.diceExtractor.parseDiceFormula(rollData, modifier);
    const dice = this.diceExtractor.extractDiceResults(rollData);
    return this.rollBuilder.buildRollWithDDBResults(formula, dice);
  }

  /**
   * Death save through dnd5e's own rollDeathSave with the DDB dice injected,
   * so the actor's successes/failures (and nat 1 / nat 20) update exactly as
   * when TokenBar rolls it. No chat card: the TokenBar card shows the result.
   * @returns {Promise<Roll|null>} null if dnd5e declined (stable, dead, ...)
   * @private
   */
  async _systemDeathSave(actor, rollData) {
    if (typeof actor.rollDeathSave !== 'function') return null;
    const parsed = this.diceExtractor.parseDiceFormula(rollData);
    DDBRollInjector.setPending(rollData);
    try {
      const result = await actor.rollDeathSave(
        { advantage: parsed.isAdvantage, disadvantage: parsed.isDisadvantage },
        { configure: false },
        { create: false }
      );
      return (Array.isArray(result) ? result[0] : result) ?? null;
    } finally {
      DDBRollInjector.clearPending();
    }
  }

  /**
   * Put an initiative result into the combat tracker, like InitiativeRollHandler.
   * @private
   */
  async _setInitiative(actor, total) {
    const combatant = game.combat?.combatants?.find(c => c.actor?.id === actor.id);
    if (combatant) await game.combat.setInitiative(combatant.id, total);
  }

  /**
   * TokenBar exposes no public handle to SavingThrow; import its module (same
   * URL as TokenBar's own esmodule, so the same module instance).
   * @private
   */
  async _loadSavingThrow() {
    if (!this._savingThrowModule) {
      const path = foundry.utils.getRoute(MonksTokenBarBridge.SAVINGTHROW_PATH);
      this._savingThrowModule = import(path).catch(err => {
        this._savingThrowModule = null;
        throw err;
      });
    }
    return this._savingThrowModule;
  }

  /** @private */
  async _onCreate(message) {
    const flags = message?.flags?.[MonksTokenBarBridge.TOKENBAR_ID];
    if (!MonksTokenBarBridge.hasDDBRequest(flags) || !this.isActive()) return;
    if (!MonksTokenBarBridge.pendingTokens(flags).length) return;

    this._track(message.id);
    await this._whisperPlayers(flags);
  }

  /** @private */
  _onUpdate(message) {
    if (!this.pending.includes(message?.id)) return;
    const flags = message.flags?.[MonksTokenBarBridge.TOKENBAR_ID];
    if (!MonksTokenBarBridge.pendingTokens(flags).length) this._forget(message.id);
  }

  /**
   * Pick up cards still open from before a reload (no whispers this time).
   * @private
   */
  _resumeOpenCards() {
    if (!game.modules.get(MonksTokenBarBridge.TOKENBAR_ID)?.active) return;
    const now = Date.now();
    for (const message of game.messages?.contents ?? []) {
      const flags = message.flags?.[MonksTokenBarBridge.TOKENBAR_ID];
      if (!MonksTokenBarBridge.hasDDBRequest(flags)) continue;
      if (!MonksTokenBarBridge.isFresh(message.timestamp, now)) continue;
      if (MonksTokenBarBridge.pendingTokens(flags).length) this._track(message.id);
    }
  }

  /**
   * Whisper each DDB-mapped actor's player owners (and the GMs) to roll on DDB.
   * Actors without a player owner (the GM rolls them) get no whisper.
   * @private
   */
  async _whisperPlayers(flags) {
    const label = MonksTokenBarBridge.requestLabel(flags.requests);
    if (!label) return;
    const mappedIds = new Set(Object.values(this.characterMapper?.mapping || {}).map(String));
    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
    const seen = new Set();

    for (const token of MonksTokenBarBridge.pendingTokens(flags)) {
      if (seen.has(token.actorid) || !mappedIds.has(String(token.actorid))) continue;
      seen.add(token.actorid);
      const actor = game.actors.get(token.actorid);
      if (!actor) continue;
      const owners = game.users
        .filter(u => !u.isGM && actor.testUserPermission(u, 'OWNER'))
        .map(u => u.id);
      if (!owners.length) continue;

      await ChatMessage.implementation.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        whisper: [...new Set([...owners, ...gmIds])],
        content: `<p><i class="fas fa-dice-d20"></i> ${game.i18n.format('DDB.MonksTokenBar.RollOnDDB', {
          request: MonksTokenBarBridge.escape(label),
          actor: MonksTokenBarBridge.escape(actor.name)
        })}</p>`
      });
    }
  }

  /** @private */
  _track(messageId) {
    if (messageId && !this.pending.includes(messageId)) this.pending.push(messageId);
  }

  /** @private */
  _forget(messageId) {
    this.pending = this.pending.filter(id => id !== messageId);
  }

  /** Run a hook body without letting an error escape into Foundry or roll sync. @private */
  _guard(label, fn) {
    try {
      const result = fn();
      if (result?.catch) result.catch(err => this.logger.error(`DDB Sync | TokenBar bridge ${label} failed:`, err));
    } catch (err) {
      this.logger.error(`DDB Sync | TokenBar bridge ${label} failed:`, err);
    }
  }
}
