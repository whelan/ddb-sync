/**
 * RollModePolicy Tests
 *
 * Repo convention: jest (CommonJS, node env) cannot import the Foundry ES
 * modules in scripts/, so the class below is an inline mirror of
 * scripts/dice/RollModePolicy.js. If you change one, change both.
 */

class RollModePolicy {
  static logger = console;

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

describe('RollModePolicy', () => {
  beforeEach(() => {
    global.game = {
      settings: {
        get: jest.fn().mockReturnValue('1111111')
      }
    };
    RollModePolicy.logger = { warn: jest.fn() };
  });

  afterEach(() => {
    delete global.game;
    RollModePolicy.logger = console;
  });

  describe('messageOptions', () => {
    it('returns {} when the roller is the configured DDB user (string id)', () => {
      const result = RollModePolicy.messageOptions({ rollerUserId: '1111111' });
      expect(result).toEqual({});
    });

    it('returns {} when the roller id is a number and the setting is a string', () => {
      const result = RollModePolicy.messageOptions({ rollerUserId: 1111111 });
      expect(result).toEqual({});
    });

    it('forces publicroll for a different DDB user', () => {
      const result = RollModePolicy.messageOptions({ rollerUserId: '2222222' });
      expect(result).toEqual({ rollMode: 'publicroll' });
    });

    it('forces publicroll and warns when rollerUserId is missing', () => {
      const result = RollModePolicy.messageOptions({});
      expect(result).toEqual({ rollMode: 'publicroll' });
      expect(RollModePolicy.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('forces publicroll and warns when rollerUserId is null', () => {
      const result = RollModePolicy.messageOptions({ rollerUserId: null });
      expect(result).toEqual({ rollMode: 'publicroll' });
      expect(RollModePolicy.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('forces publicroll and warns when rollData itself is undefined', () => {
      const result = RollModePolicy.messageOptions(undefined);
      expect(result).toEqual({ rollMode: 'publicroll' });
      expect(RollModePolicy.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('forces publicroll when the userId setting is empty', () => {
      global.game.settings.get.mockReturnValue('');
      const result = RollModePolicy.messageOptions({ rollerUserId: '1111111' });
      expect(result).toEqual({ rollMode: 'publicroll' });
    });

    it('reads the userId setting from the ddb-sync module', () => {
      RollModePolicy.messageOptions({ rollerUserId: '1111111' });
      expect(global.game.settings.get).toHaveBeenCalledWith('ddb-sync', 'userId');
    });

    it('does not warn for a normal player roll', () => {
      RollModePolicy.messageOptions({ rollerUserId: '2222222' });
      expect(RollModePolicy.logger.warn).not.toHaveBeenCalled();
    });
  });
});
