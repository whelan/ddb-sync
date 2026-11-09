import { Logger } from '../../utils/Logger.js';

/**
 * Spell Template Service
 * Responsibility: Offer area-of-effect templates for spell cards posted by
 * SpellCardService, and clean those templates up as combat moves on
 * SOLID: Single Responsibility - template button, placement and cleanup only
 *
 * The card carries flags['ddb-sync'].spellCard = { actorUuid, itemUuid }. When
 * the spell has an area (dnd5e activity `target.template.type`), every client
 * renders a "Place template" button on the card for the GM and the actor's
 * owners. Placement goes through dnd5e's own AbilityTemplate preview, so it
 * snaps and measures exactly like casting from the sheet.
 *
 * Templates placed this way are flagged with the combat state at creation:
 * flags['ddb-sync'].spellTemplate = { combatId, round, turn }. On every
 * combat update the active GM deletes the flagged templates whose time is up,
 * according to the world setting `spellTemplateCleanup` (never/turn/round).
 *
 * Hooks are registered for every user (from main.js), since players place
 * templates too; only the GM ever deletes.
 */
export class SpellTemplateService {
  static MODULE_ID = 'ddb-sync';
  static CLEANUP_MODES = ['never', 'turn', 'round'];
  static DEFAULT_CLEANUP = 'round';
  /** Legacy (pre-activity) dnd5e area target types. */
  static AREA_TYPES = ['cone', 'cube', 'cylinder', 'line', 'sphere', 'radius', 'square', 'wall'];

  static _registered = false;

  // ---------------------------------------------------------------------------
  // Pure helpers (mirrored in tests/core/services/SpellTemplateService.test.js)
  // ---------------------------------------------------------------------------

  /**
   * Where a spell's area of effect is defined.
   * @param {Object} item - A dnd5e spell item
   * @returns {{activity: Object|null, type: string}|null} null if the spell has no area
   */
  static templateInfo(item) {
    const system = item?.system;
    if (!system) return null;

    // dnd5e v4+: area lives on an activity
    let activities = [];
    try {
      activities = Array.from(system.activities ?? []);
    } catch {
      activities = [];
    }
    const activity = activities.find((a) => a?.target?.template?.type);
    if (activity) return { activity, type: activity.target.template.type };

    // dnd5e v3: item-level target
    const legacy = system.target?.template?.type
      ?? (SpellTemplateService.AREA_TYPES.includes(system.target?.type) ? system.target.type : null);
    return legacy ? { activity: null, type: legacy } : null;
  }

  /**
   * Has a template's time run out?
   * @param {{combatId: string|null, round: number, turn: number}|undefined} flag - State at creation
   * @param {{id: string, round: number, turn: number}|null} combat - Current combat state
   * @param {'never'|'turn'|'round'} mode
   * @returns {boolean}
   */
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

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------

  /** Register chat and combat hooks once, on every client. */
  static registerHooks() {
    if (this._registered) return;
    this._registered = true;
    Hooks.on('renderChatMessageHTML', (message, html) => this._safe(() => this.onRenderChatMessage(message, html)));
    Hooks.on('updateCombat', (combat, changed) => {
      if (!('round' in (changed ?? {})) && !('turn' in (changed ?? {}))) return;
      this._safe(() => this.cleanupTemplates(combat));
    });
    Hooks.on('deleteCombat', (combat) => this._safe(() => this.cleanupTemplates(combat, true)));
  }

  static async _safe(fn) {
    try {
      await fn();
    } catch (err) {
      Logger.error('DDB Sync | Spell template error:', err);
    }
  }

  static _resolve(uuid) {
    if (!uuid) return null;
    try {
      return fromUuidSync(uuid);
    } catch {
      return null;
    }
  }

  /**
   * Add a "Place template" button to spell cards with an area of effect.
   * @param {ChatMessage} message
   * @param {HTMLElement} html
   */
  static onRenderChatMessage(message, html) {
    const card = message?.getFlag?.(this.MODULE_ID, 'spellCard');
    if (!card) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector('.ddb-sync-place-template')) return;

    const item = this._resolve(card.itemUuid);
    const actor = item?.actor ?? this._resolve(card.actorUuid);
    if (!item || !actor || !(game.user.isGM || actor.isOwner)) return;
    if (!this.templateInfo(item)) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ddb-sync-place-template';
    button.innerHTML = `<i class="fas fa-ruler-combined"></i> ${game.i18n.localize('DDB.SpellTemplate.Place')}`;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      this._safe(() => this.placeTemplate(item));
    });

    const container = root.querySelector('.card-buttons') ?? root.querySelector('.message-content') ?? root;
    container.appendChild(button);
  }

  /**
   * Preview and place the spell's template(s) with dnd5e's AbilityTemplate.
   * @param {Item} item
   */
  static async placeTemplate(item) {
    const info = this.templateInfo(item);
    const AbilityTemplate = globalThis.dnd5e?.canvas?.AbilityTemplate;
    if (!info || !AbilityTemplate || !canvas?.scene) {
      ui.notifications?.warn(game.i18n.localize('DDB.SpellTemplate.Unavailable'));
      return;
    }

    let created = null;
    if (info.activity && typeof AbilityTemplate.fromActivity === 'function') {
      created = AbilityTemplate.fromActivity(info.activity);
    } else if (typeof AbilityTemplate.fromItem === 'function') {
      created = AbilityTemplate.fromItem(item);
    }
    const templates = [created].flat().filter(Boolean);
    if (!templates.length) {
      ui.notifications?.warn(game.i18n.localize('DDB.SpellTemplate.Unavailable'));
      return;
    }

    const combat = game.combat;
    const spellTemplate = {
      combatId: combat?.started ? combat.id : null,
      round: combat?.round ?? 0,
      turn: combat?.turn ?? 0
    };
    for (const template of templates) {
      template.document?.updateSource?.({ flags: { [this.MODULE_ID]: { spellTemplate } } });
      await template.drawPreview();
    }
  }

  /**
   * Delete flagged templates whose time has run out. Active GM only.
   * @param {Combat} combat
   * @param {boolean} [ended=false] - Combat was deleted: remove all of its templates
   */
  static async cleanupTemplates(combat, ended = false) {
    const activeGM = game.users?.activeGM;
    if (!game.user.isGM || (activeGM && !activeGM.isSelf)) return;

    let mode = this.DEFAULT_CLEANUP;
    try {
      mode = game.settings.get(this.MODULE_ID, 'spellTemplateCleanup') ?? mode;
    } catch { /* setting not registered yet */ }
    if (mode === 'never') return;

    for (const scene of game.scenes ?? []) {
      const ids = scene.templates
        .filter((t) => {
          const flag = t.getFlag(this.MODULE_ID, 'spellTemplate');
          if (ended) return flag?.combatId === combat.id;
          return this.shouldDeleteTemplate(flag, { id: combat.id, round: combat.round, turn: combat.turn }, mode);
        })
        .map((t) => t.id);
      if (ids.length) {
        await scene.deleteEmbeddedDocuments('MeasuredTemplate', ids);
        Logger.log(`DDB Sync | Removed ${ids.length} expired spell template(s) from ${scene.name}`);
      }
    }
  }
}
