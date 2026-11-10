import { ICharacterSync } from '../interfaces/ICharacterSync.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Spell Slot Notifier
 * Responsibility: Post a chat message when a player spends a spell slot on D&D Beyond
 * SOLID: Single Responsibility - only reports spell slot usage, never changes the actor
 *
 * DDB sends no "spell cast" event. Casting a spell on the sheet spends a slot,
 * which arrives as a plain character-update, so the notifier compares the
 * `used` count of every slot level (and pact magic) against the last state it
 * saw for that character. The first update after a reload only records the
 * baseline - otherwise every slot already spent would be announced at once.
 * DDB does not say which spell was cast, only the slot level; cantrips and
 * free casts spend no slot and are therefore not reported.
 *
 * When SpellCardService already posted the spell's card for this actor a
 * moment ago, the slot message is skipped (the baseline is still updated).
 */
export class SpellSlotNotifier extends ICharacterSync {
  /**
   * @param {Object} [options]
   * @param {(actorId: string) => boolean} [options.recentlyAnnounced] - True if a
   *   spell card was just posted for the actor
   */
  constructor({ recentlyAnnounced = null } = {}) {
    super();
    this.logger = Logger;
    this.recentlyAnnounced = recentlyAnnounced;
    /** @type {Map<string, Object<string, number>>} DDB character id -> slot key -> used */
    this.lastUsed = new Map();
  }

  isEnabled() {
    try {
      return game.settings.get('ddb-sync', 'notifySpellSlots') !== false;
    } catch {
      return true;
    }
  }

  /**
   * Snapshot of used slots, keyed "spell-<level>" / "pact-<level>".
   * @param {Object} character - The DDB character JSON
   * @returns {Object<string, number>}
   */
  static usedSlots(character) {
    const snapshot = {};
    for (const [prefix, list] of [['spell', character?.spellSlots], ['pact', character?.pactMagic]]) {
      for (const slot of Array.isArray(list) ? list : []) {
        const level = Number(slot?.level);
        if (!level) continue;
        snapshot[`${prefix}-${level}`] = Number(slot?.used) || 0;
      }
    }
    return snapshot;
  }

  /**
   * Slots spent between two snapshots.
   * @returns {Array<{pact: boolean, level: number, count: number}>}
   */
  static spentSlots(previous, current) {
    const spent = [];
    for (const [key, used] of Object.entries(current)) {
      const count = used - (previous[key] ?? used);
      if (count <= 0) continue;
      const [prefix, level] = key.split('-');
      spent.push({ pact: prefix === 'pact', level: Number(level), count });
    }
    return spent.sort((a, b) => a.level - b.level);
  }

  async applyFromCharacter(actor, character) {
    if (!actor || !character) return;

    const id = String(character.id ?? actor.id);
    const current = SpellSlotNotifier.usedSlots(character);
    const previous = this.lastUsed.get(id);
    this.lastUsed.set(id, current);
    if (!previous) return;

    const spent = SpellSlotNotifier.spentSlots(previous, current);
    if (!spent.length) return;
    if (this.recentlyAnnounced?.(actor.id)) {
      this.logger.log(`DDB Sync | ${actor.name} slot spend already covered by a spell card`);
      return;
    }

    const lines = spent.map(({ pact, level, count }) =>
      `${count > 1 ? `${count}× ` : ''}level ${level} ${pact ? 'pact magic slot' : 'spell slot'}`
    );
    const content = `<p><i class="fas fa-hat-wizard"></i> <strong>${actor.name}</strong> casts a spell `
      + `(spent ${lines.join(', ')} on D&D Beyond)</p>`;

    this.logger.log(`DDB Sync | ${actor.name} spent ${lines.join(', ')}`);

    const data = { content, speaker: ChatMessage.getSpeaker({ actor }) };
    if (game.settings.get('ddb-sync', 'notifySpellSlotsGmOnly')) {
      data.whisper = ChatMessage.getWhisperRecipients('GM').map((u) => u.id);
    }
    await ChatMessage.create(data);
  }
}
