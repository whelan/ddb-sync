/**
 * RollModePolicy Tests
 *
 * Repo convention: jest (CommonJS, node env) cannot import the Foundry ES
 * modules in scripts/, so the class below is an inline mirror of
 * scripts/dice/RollModePolicy.js. If you change one, change both.
 */

class RollModePolicy {
  static messageMode(actor) {
    // Player-owned actors always post publicly; GM-only actors (NPCs,
    // monsters, the GM's own characters) follow the GM's dropdown.
    return actor?.hasPlayerOwner ? 'public' : undefined;
  }

  static messageOptions(actor) {
    const messageMode = RollModePolicy.messageMode(actor);
    return messageMode ? { messageMode } : {};
  }

  static suppressAnimation() {
    // game.dice3d?.suppressForCurrentUser?.() — no-op in tests (no Foundry globals)
  }
}

describe('RollModePolicy', () => {
  describe('messageOptions', () => {
    it('forces the public message mode for a player-owned actor', () => {
      const result = RollModePolicy.messageOptions({ hasPlayerOwner: true });
      expect(result).toEqual({ messageMode: 'public' });
    });

    it('never emits the legacy rollMode option ignored by v14 Roll#toMessage', () => {
      const result = RollModePolicy.messageOptions({ hasPlayerOwner: true });
      expect(result).not.toHaveProperty('rollMode');
    });

    it('returns {} for a GM-only actor (no player owner)', () => {
      const result = RollModePolicy.messageOptions({ hasPlayerOwner: false });
      expect(result).toEqual({});
    });

    it('returns {} when hasPlayerOwner is missing from the actor', () => {
      const result = RollModePolicy.messageOptions({});
      expect(result).toEqual({});
    });

    it('returns {} when the actor is null', () => {
      const result = RollModePolicy.messageOptions(null);
      expect(result).toEqual({});
    });

    it('returns {} when the actor is undefined', () => {
      const result = RollModePolicy.messageOptions(undefined);
      expect(result).toEqual({});
    });
  });

  describe('messageMode', () => {
    it("returns 'public' for a player-owned actor", () => {
      expect(RollModePolicy.messageMode({ hasPlayerOwner: true })).toBe('public');
    });

    it('returns undefined for a GM-only actor', () => {
      expect(RollModePolicy.messageMode({ hasPlayerOwner: false })).toBeUndefined();
    });

    it('returns undefined when the actor is null or undefined', () => {
      expect(RollModePolicy.messageMode(null)).toBeUndefined();
      expect(RollModePolicy.messageMode(undefined)).toBeUndefined();
    });
  });

  describe('suppressAnimation', () => {
    it('does not throw when called without Foundry globals', () => {
      expect(() => RollModePolicy.suppressAnimation()).not.toThrow();
    });
  });
});
