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
 * client's current chat message-mode dropdown (Foundry v14 applies it
 * automatically when no mode is passed).
 *
 * Foundry v14 names the visibility option differently per API:
 *  - core Roll#toMessage(data, { messageMode })        -> messageOptions(actor)
 *  - dnd5e 6 message configs ({ rollMode }) used by
 *    Item#displayCard, Actor#rollDeathSave, BasicRoll.toMessage
 *                                                     -> messageMode(actor)
 * Both take v14 message-mode values ('public', 'gm', 'blind', 'self');
 * the legacy 'publicroll' etc. strings are no longer understood.
 *
 * NOTE: tests/dice/RollModePolicy.test.js contains a mirror copy of this
 * class (jest cannot import Foundry ES modules). Keep them in sync.
 */
export class RollModePolicy {
  /**
   * Resolve the v14 message mode for a synced DDB roll.
   * Use this for dnd5e 6 message configurations, whose option is still
   * named `rollMode` but takes a v14 message-mode value.
   * @param {Actor} actor - The Foundry actor the roll belongs to
   * @returns {string|undefined} 'public' for a player-owned actor, or
   *   undefined to follow the GM's message-mode dropdown.
   */
  static messageMode(actor) {
    // Player-owned actors always post publicly; GM-only actors (NPCs,
    // monsters, the GM's own characters) follow the GM's dropdown.
    return actor?.hasPlayerOwner ? 'public' : undefined;
  }

  /**
   * Resolve the options object for core Roll#toMessage for a synced DDB roll.
   * @param {Actor} actor - The Foundry actor the roll belongs to
   * @returns {Object} { messageMode: 'public' } to force a public roll for a
   *   player-owned actor, or {} to follow the GM's message-mode dropdown.
   */
  static messageOptions(actor) {
    const messageMode = RollModePolicy.messageMode(actor);
    return messageMode ? { messageMode } : {};
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
