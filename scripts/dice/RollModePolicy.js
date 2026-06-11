/**
 * Roll Mode Policy
 * Responsibility: Decide the Foundry chat roll mode for synced DDB rolls
 * SOLID: Single Responsibility - only resolves Roll#toMessage options
 *
 * Rolls made by the configured DDB user (the GM) follow the GM client's
 * current core.rollMode dropdown (Foundry v13 applies it automatically when
 * no rollMode option is passed). Rolls from any other DDB user are always
 * posted publicly so the GM's dropdown can never hide a player's roll.
 *
 * NOTE: tests/dice/RollModePolicy.test.js contains a mirror copy of this
 * class (jest cannot import Foundry ES modules). Keep them in sync.
 */
export class RollModePolicy {
  static logger = console;

  /**
   * Resolve the options object for Roll#toMessage for a synced DDB roll.
   * @param {Object} rollData - Roll data dispatched from the websocket layer
   * @param {string|number|null} [rollData.rollerUserId] - DDB user id of the roller
   * @returns {Object} {} to follow the GM's roll-mode dropdown,
   *   or { rollMode: 'publicroll' } to force a public roll.
   */
  static messageOptions(rollData) {
    const rollerUserId = rollData?.rollerUserId;
    if (rollerUserId === null || rollerUserId === undefined) {
      this.logger.warn('DDB Sync | Roll arrived without a roller userId; posting publicly');
      return { rollMode: 'publicroll' };
    }
    const ownUserId = game.settings.get('ddb-sync', 'userId');
    if (String(rollerUserId) === String(ownUserId)) {
      // GM's own roll: let Foundry apply the current core.rollMode dropdown
      return {};
    }
    return { rollMode: 'publicroll' };
  }
}
