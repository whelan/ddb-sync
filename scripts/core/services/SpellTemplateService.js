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
 * owners. Placement goes through dnd5e's own TemplatePlacement, so it
 * snaps and measures exactly like casting from the sheet.
 *
 * Areas placed this way (Regions, Foundry v14 / dnd5e 6) are flagged with the combat state at creation:
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

  static _registered = false;

  // ---------------------------------------------------------------------------
  // Pure helpers (mirrored in tests/core/services/SpellTemplateService.test.js)
  // ---------------------------------------------------------------------------

  /**
   * Where a spell's area of effect is defined.
   * @param {Object} item - A dnd5e spell item
   * @returns {{activity: Object, type: string}|null} null if the spell has no area
   */
  static templateInfo(item) {
    const system = item?.system;
    if (!system) return null;

    // dnd5e 6: the area lives on an activity
    let activities = [];
    try {
      activities = Array.from(system.activities ?? []);
    } catch {
      activities = [];
    }
    const activity = activities.find((a) => a?.target?.template?.type);
    return activity ? { activity, type: activity.target.template.type } : null;
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
      return foundry.utils.fromUuidSync(uuid);
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
    const root = html;
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
   * Combat state stamped on a placed template so cleanup knows when it expires.
   * @returns {{combatId: string|null, round: number, turn: number}}
   */
  static combatStamp() {
    const combat = game.combat;
    return {
      combatId: combat?.started ? combat.id : null,
      round: combat?.round ?? 0,
      turn: combat?.turn ?? 0
    };
  }

  /**
   * Let the user place the spell's area with the system's own placement tool.
   *
   * dnd5e 6 places areas as Regions through
   * `dnd5e.canvas.TemplatePlacement.fromActivity`, which awaits the placement
   * and creates the regions with `createData` merged in - so our flag rides
   * along.
   * @param {Item} item
   */
  static async placeTemplate(item) {
    const info = this.templateInfo(item);
    const TemplatePlacement = globalThis.dnd5e?.canvas?.TemplatePlacement;
    if (!info || typeof TemplatePlacement?.fromActivity !== 'function' || !canvas?.scene) {
      ui.notifications?.warn(game.i18n.localize('DDB.SpellTemplate.Unavailable'));
      return;
    }
    const flags = { [this.MODULE_ID]: { spellTemplate: this.combatStamp() } };
    await TemplatePlacement.fromActivity(info.activity, { createData: { flags } });
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

    const expired = (doc) => {
      const flag = doc.getFlag?.(this.MODULE_ID, 'spellTemplate');
      if (ended) return !!flag && flag.combatId === combat.id;
      return this.shouldDeleteTemplate(flag, { id: combat.id, round: combat.round, turn: combat.turn }, mode);
    };

    for (const scene of game.scenes ?? []) {
      const ids = (scene.regions ?? []).filter(expired).map((d) => d.id);
      if (!ids.length) continue;
      await scene.deleteEmbeddedDocuments('Region', ids);
      Logger.log(`DDB Sync | Removed ${ids.length} expired spell area(s) from ${scene.name}`);
    }
  }
}
