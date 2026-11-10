/**
 * SpellSlotNotifier Tests
 *
 * Repo convention: jest (CommonJS, node env) cannot import the Foundry ES
 * modules in scripts/, so the class below is an inline mirror of
 * scripts/core/services/SpellSlotNotifier.js. If you change one, change both.
 */

class SpellSlotNotifier {
  constructor({ recentlyAnnounced = null } = {}) {
    this.logger = { log: jest.fn() };
    this.recentlyAnnounced = recentlyAnnounced;
    this.lastUsed = new Map();
  }

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

const char = (used, pact = []) => ({
  id: 42,
  spellSlots: used.map((u, i) => ({ level: i + 1, used: u, available: 4 })),
  pactMagic: pact.map((u, i) => ({ level: i + 1, used: u, available: 2 }))
});

describe('SpellSlotNotifier', () => {
  let notifier;
  let gmOnly;
  const actor = { id: 'a1', name: 'Ireena' };

  beforeEach(() => {
    notifier = new SpellSlotNotifier();
    gmOnly = false;
    global.game = { settings: { get: jest.fn(() => gmOnly) } };
    global.ChatMessage = {
      create: jest.fn(),
      getSpeaker: jest.fn(() => ({ alias: 'Ireena' })),
      getWhisperRecipients: jest.fn(() => [{ id: 'gm1' }])
    };
  });

  it('only records a baseline on the first update', async () => {
    await notifier.applyFromCharacter(actor, char([2, 1]));
    expect(ChatMessage.create).not.toHaveBeenCalled();
  });

  it('announces a spent spell slot', async () => {
    await notifier.applyFromCharacter(actor, char([0, 0]));
    await notifier.applyFromCharacter(actor, char([0, 1]));
    expect(ChatMessage.create).toHaveBeenCalledTimes(1);
    const msg = ChatMessage.create.mock.calls[0][0];
    expect(msg.content).toContain('level 2 spell slot');
    expect(msg.whisper).toBeUndefined();
  });

  it('announces pact magic and multiple slots', async () => {
    await notifier.applyFromCharacter(actor, char([0], [0, 0]));
    await notifier.applyFromCharacter(actor, char([2], [0, 1]));
    const { content } = ChatMessage.create.mock.calls[0][0];
    expect(content).toContain('2× level 1 spell slot, level 2 pact magic slot');
  });

  it('stays silent on rests and unrelated updates', async () => {
    await notifier.applyFromCharacter(actor, char([2, 1]));
    await notifier.applyFromCharacter(actor, char([2, 1]));
    await notifier.applyFromCharacter(actor, char([0, 0]));
    expect(ChatMessage.create).not.toHaveBeenCalled();
  });

  it('whispers to the GM when configured', async () => {
    gmOnly = true;
    await notifier.applyFromCharacter(actor, char([0]));
    await notifier.applyFromCharacter(actor, char([1]));
    expect(ChatMessage.create.mock.calls[0][0].whisper).toEqual(['gm1']);
  });

  it('skips the slot message when a spell card was just posted', async () => {
    const recentlyAnnounced = jest.fn((id) => id === 'a1');
    notifier = new SpellSlotNotifier({ recentlyAnnounced });
    await notifier.applyFromCharacter(actor, char([0]));
    await notifier.applyFromCharacter(actor, char([1]));
    expect(recentlyAnnounced).toHaveBeenCalledWith('a1');
    expect(ChatMessage.create).not.toHaveBeenCalled();
    // baseline still advanced: the next spend without a card is announced once
    recentlyAnnounced.mockReturnValue(false);
    await notifier.applyFromCharacter(actor, char([2]));
    expect(ChatMessage.create).toHaveBeenCalledTimes(1);
    expect(ChatMessage.create.mock.calls[0][0].content).toContain('level 1 spell slot');
  });

  it('tracks characters separately', async () => {
    await notifier.applyFromCharacter(actor, char([0]));
    await notifier.applyFromCharacter(actor, { ...char([1]), id: 7 });
    expect(ChatMessage.create).not.toHaveBeenCalled();
  });
});
