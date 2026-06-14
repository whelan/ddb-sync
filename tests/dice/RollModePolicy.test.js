/**
 * RollModePolicy Tests
 *
 * Repo convention: jest (CommonJS, node env) cannot import the Foundry ES
 * modules in scripts/, so the class below is an inline mirror of
 * scripts/dice/RollModePolicy.js. If you change one, change both.
 */

class RollModePolicy {
  static messageOptions(actor) {
    // Player-owned actors always post publicly; GM-only actors (NPCs,
    // monsters, the GM's own characters) follow the GM's roll-mode dropdown.
    if (actor?.hasPlayerOwner) {
      return { rollMode: 'publicroll' };
    }
    return {};
  }
}

describe('RollModePolicy', () => {
  describe('messageOptions', () => {
    it('forces publicroll for a player-owned actor', () => {
      const result = RollModePolicy.messageOptions({ hasPlayerOwner: true });
      expect(result).toEqual({ rollMode: 'publicroll' });
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
});
