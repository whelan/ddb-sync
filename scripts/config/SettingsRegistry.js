/**
 * Settings Registry - Manages all module settings registration
 * Responsibility: Register and manage game settings
 * SOLID: Single Responsibility - only handles settings registration
 */
import { CharacterMappingApplication } from '../ui/CharacterMappingApplication.js';
import { Logger } from '../utils/Logger.js';

export class SettingsRegistry {
  static MODULE_ID = 'ddb-sync';

  static registerAll() {
    this.registerCharacterMappingMenu();
    this.registerAuthenticationSettings();
    this.registerSyncSettings();
    this.registerDataSettings();
  }

  static registerCharacterMappingMenu() {
    game.settings.registerMenu(this.MODULE_ID, 'characterMappingMenu', {
      name: 'DDB.Settings.CharacterMapping.Name',
      label: 'DDB.Settings.CharacterMapping.Label',
      hint: 'DDB.Settings.CharacterMapping.Hint',
      icon: 'fas fa-users',
      type: CharacterMappingApplication,
      restricted: true
    });
  }

  static registerAuthenticationSettings() {
    // CobaltSession Cookie Setting
    game.settings.register(this.MODULE_ID, 'cobaltCookie', {
      name: 'DDB.Settings.CobaltCookie.Name',
      hint: 'DDB.Settings.CobaltCookie.Hint',
      scope: 'world',
      config: true,
      type: String,
      default: '',
      onChange: value => game.DDBSync?.reconnectWebSocket?.()
    });

    // Proxy URL Setting
    game.settings.register(this.MODULE_ID, 'proxyUrl', {
      name: 'DDB.Settings.ProxyUrl.Name',
      hint: 'DDB.Settings.ProxyUrl.Hint',
      scope: 'world',
      config: true,
      type: String,
      default: 'http://localhost:3000'
    });
    game.settings.register('ddb-sync', 'proxyUsername', {
      name: "Proxy Username",
      hint: "Username for Basic Auth on your custom DDB Proxy.",
      scope: "world",
      config: true,
      type: String,
      default: ""
    });

    game.settings.register('ddb-sync', 'proxyPassword', {
      name: "Proxy Password",
      hint: "Password for Basic Auth on your custom DDB Proxy.",
      scope: "world",
      config: true,
      type: String,
      default: ""
  });
    // User ID Setting
    game.settings.register(this.MODULE_ID, 'userId', {
      name: 'DDB.Settings.UserId.Name',
      hint: 'DDB.Settings.UserId.Hint',
      scope: 'world',
      config: true,
      type: String,
      default: '',
      onChange: value => game.DDBSync?.reconnectWebSocket?.()
    });

    // Campaign ID Setting
    game.settings.register(this.MODULE_ID, 'campaignId', {
      name: 'DDB.Settings.CampaignId.Name',
      hint: 'DDB.Settings.CampaignId.Hint',
      scope: 'world',
      config: true,
      type: String,
      default: '',
      onChange: value => game.DDBSync?.reconnectWebSocket?.()
    });

    // Enable/Disable Module
    game.settings.register(this.MODULE_ID, 'enabled', {
      name: 'DDB.Settings.Enabled.Name',
      hint: 'DDB.Settings.Enabled.Hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
      onChange: value => {
        if (value) {
          game.DDBSync?.connect?.();
        } else {
          game.DDBSync?.disconnect?.();
        }
      }
    });
  }

  static registerSyncSettings() {
    game.settings.register(this.MODULE_ID, 'debugMode', {
      name: 'Debug Logging',
      hint: 'Log detailed roll info to the browser console. Disable for best performance at the table.',
      scope: 'client',
      config: true,
      type: Boolean,
      default: false,
      onChange: () => Logger.invalidateCache()
    });

    // Update character damage only
    game.settings.register(this.MODULE_ID, 'updateDamageOnly', {
      name: 'DDB.Settings.UpdateDamageOnly.Name',
      hint: 'DDB.Settings.UpdateDamageOnly.Hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true
    });
  }

  static registerDataSettings() {
    // Character Mapping Setting (stored as JSON)
    game.settings.register(this.MODULE_ID, 'characterMapping', {
      name: 'Character Mapping',
      scope: 'world',
      config: false,
      type: Object,
      default: {}
    });
  }

  static get(settingKey) {
    return game.settings.get(this.MODULE_ID, settingKey);
  }

  static async set(settingKey, value) {
    return game.settings.set(this.MODULE_ID, settingKey, value);
  }
}
