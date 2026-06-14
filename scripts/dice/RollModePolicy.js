/**
 * Roll Mode Policy
 * Responsibility: Decide the Foundry chat roll mode for synced DDB rolls
 * SOLID: Single Responsibility - only resolves Roll#toMessage options
 *
 * The discriminator is Foundry actor ownership, not the DDB roller: in many
 * setups the GM rolls every character from a single DDB account, so the
 * envelope userId can't tell a player-character roll from the GM's own.
 * Actor ownership works regardless of who clicks the dice.
 *
 * Rolls for player-owned actors are always posted publicly. Rolls for
 * GM-only actors (NPCs, monsters, the GM's own characters) follow the GM
 * client's current core.rollMode dropdown (Foundry v13 applies it
 * automatically when no rollMode option is passed).
 *
 * NOTE: tests/dice/RollModePolicy.test.js contains a mirror copy of this
 * class (jest cannot import Foundry ES modules). Keep them in sync.
 */
export class RollModePolicy {
  /**
   * Resolve the options object for Roll#toMessage for a synced DDB roll.
   * @param {Actor} actor - The Foundry actor the roll belongs to
   * @returns {Object} { rollMode: 'publicroll' } to force a public roll for a
   *   player-owned actor, or {} to follow the GM's roll-mode dropdown.
   */
  static messageOptions(actor) {
    // Player-owned actors always post publicly; GM-only actors (NPCs,
    // monsters, the GM's own characters) follow the GM's roll-mode dropdown.
    if (actor?.hasPlayerOwner) {
      return { rollMode: 'publicroll' };
    }
    return {};
  }

  /**
   * Suppress the Dice So Nice! animation for the next roll.toMessage() call.
   * DDB already showed the dice rolling; re-animating in Foundry adds ~1-3s
   * of visual latency before the result becomes readable in chat.
   */
  static suppressAnimation() {
    game.dice3d?.suppressForCurrentUser?.();
  }
}
