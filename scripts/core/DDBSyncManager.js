import { SettingsRegistry } from '../config/SettingsRegistry.js';
import { SettingsValidator } from './validators/SettingsValidator.js';
import { WebSocketManager } from './services/WebSocketManager.js';
import { CharacterDataService } from './services/CharacterDataService.js';
import { DamageSyncService } from './services/DamageSyncService.js';
import { MessageDispatcher } from './services/MessageDispatcher.js';
import { DamageMessageHandler } from './handlers/DamageMessageHandler.js';
import { DiceRollMessageHandler } from './handlers/DiceRollMessageHandler.js';
import { CharacterMapper } from './services/CharacterMapper.js';
import { DiceRollHandler } from '../dice/DiceRollHandler.js';
import { InitiativeRollHandler } from '../dice/handlers/InitiativeRollHandler.js';
import { GenericRollHandler } from '../dice/handlers/GenericRollHandler.js';
import { DamageRollHandler } from '../dice/handlers/DamageRollHandler.js';
import { MessageDeduplicator } from '../websocket/MessageDeduplicator.js';
import { DiceInputDialog } from '../ui/DiceInputDialog.js';
import { SaveRollHandler } from '../dice/handlers/SaveRollHandler.js';
import { AbilityCheckRollHandler } from '../dice/handlers/AbilityCheckRollHandler.js';
import { AttackRollHandler } from '../dice/handlers/AttackRollHandler.js';

/**
 * DDB Sync Manager - Main Orchestrator
 * Responsibility: Orchestrate module components and manage lifecycle
 * SOLID: Facade Pattern - coordinates multiple services, Dependency Inversion - depends on abstractions
 */
export class DDBSyncManager {
  static ID = 'ddb-sync';
  static SOCKET_NAMESPACE = 'module.ddb-sync';

  constructor() {
    // Initialize services
    this.characterDataService = new CharacterDataService();
    this.damageSyncService = new DamageSyncService(this.characterDataService);
    this.messageDispatcher = new MessageDispatcher();
    this.websocketManager = null;
    this.messageDeduplicator = new MessageDeduplicator();

    // Legacy components (to be refactored later)
    this.characterMapper = new CharacterMapper();
    this.diceRollHandler = new DiceRollHandler();

    // Initialize dice roll message handler (for DDB dice mode) with character mapper and dice roll handler
    this.diceRollMessageHandler = new DiceRollMessageHandler(this.characterMapper, this.diceRollHandler);

    // Initialize dice input dialog with handler injection
    this.diceInputDialog = new DiceInputDialog(this.diceRollMessageHandler);

    // Register message handlers and roll handlers
    this.registerHandlers();
    this.registerRollHandlers();
  }

  /**
   * Register message handlers with the dispatcher
   * SOLID: Open/Closed - easy to add new handlers without modifying this code
   */
  registerHandlers() {
    const damageHandler = new DamageMessageHandler(this.damageSyncService);
    this.messageDispatcher.registerHandler(damageHandler);

    // Register dice roll handler for DDB dice mode
    this.messageDispatcher.registerHandler(this.diceRollMessageHandler);
  }

  /**
   * Register roll handlers with the dice roll handler dispatcher
   * SOLID: Open/Closed - can add new roll types without modifying this code
   */
  registerRollHandlers() {
    const services = this.diceRollHandler.getServices();
    const { diceExtractor, rollBuilder } = services;

    // Registration order matters — RollStrategyDispatcher uses first-match wins.
    // Specific handlers must come before GenericRollHandler (the catch-all).

    // 1. Initiative — checks action name === "initiative" before rollType
    this.diceRollHandler.registerRollHandler(
      new InitiativeRollHandler(diceExtractor, rollBuilder)
    );

    // 2. Saving throws — rollType === "save"
    this.diceRollHandler.registerRollHandler(
      new SaveRollHandler(diceExtractor, rollBuilder)
    );

    // 3. Attack rolls — rollType === "to hit"
    //    Creates usage card + D20Roll, stores usageId for step 4
    this.diceRollHandler.registerRollHandler(
      new AttackRollHandler(diceExtractor, rollBuilder)
    );

    // 4. Damage rolls — rollType === "damage"
    //    Reads usageId stored by AttackRollHandler, creates DamageRoll linked to usage card
    //    MUST come before GenericRollHandler or damage rolls fall through to the generic handler
    this.diceRollHandler.registerRollHandler(
      new DamageRollHandler(diceExtractor, rollBuilder)
    );

    // 5. Ability checks and skill checks — rollType === "check"
    this.diceRollHandler.registerRollHandler(
      new AbilityCheckRollHandler(diceExtractor, rollBuilder)
    );

    // 6. Generic fallback — canHandle() returns true for everything
    //    Must always be last
    this.diceRollHandler.registerRollHandler(
      new GenericRollHandler(diceExtractor, rollBuilder)
    );

    console.log('DDB Sync | Roll handlers registered');
  }
  static initialize() {
    console.log(`DDB Sync | Initializing D&D Beyond Sync module`);
    try {
      // Register settings using SettingsRegistry
      SettingsRegistry.registerAll();
      console.log(`DDB Sync | Settings registered successfully`);
      // Now create the instance
      game.DDBSync = new DDBSyncManager();
      console.log(`DDB Sync | DDBSyncManager instance created`);
    } catch (err) {
      console.error(`DDB Sync | Failed to initialize:`, err);
    }
  }

  async connect() {
    // Validate settings first
    const validation = SettingsValidator.validate();
    if (!validation.isValid) {
      console.warn(validation.message);
      ui.notifications.warn(validation.message);
      return;
    }

    // Get settings
    const cobaltCookie = game.settings.get(DDBSyncManager.ID, 'cobaltCookie');
    const campaignId = game.settings.get(DDBSyncManager.ID, 'campaignId');
    const userId = game.settings.get(DDBSyncManager.ID, 'userId');
    const proxyUrl = game.settings.get(DDBSyncManager.ID, 'proxyUrl');
    const proxyUser = game.settings.get(DDBSyncManager.ID, 'proxyUsername') || "";
    const proxyPass = game.settings.get(DDBSyncManager.ID, 'proxyPassword') || "";

    console.log('DDB Sync | Connection attempt - Cookie: *** Campaign:', campaignId, 'User:', userId);

    // Create WebSocket manager with dependency injection
    this.websocketManager = new WebSocketManager(cobaltCookie, campaignId, userId, proxyUrl, proxyUser, proxyPass);

    // Register event handlers
    this.websocketManager.on('message', this.handleDDBMessage.bind(this));
    this.websocketManager.on('connected', () => {
      console.log('DDB Sync | WebSocket connected successfully');
      ui.notifications.info('Connected to D&D Beyond');
    });
    this.websocketManager.on('disconnected', () => {
      console.log('DDB Sync | WebSocket disconnected');
      ui.notifications.warn('Disconnected from D&D Beyond');
    });
    this.websocketManager.on('cookieExpired', () => {
      console.log('DDB Sync | Cookie expired event received');
      this.handleCookieExpired();
    });

    try {
      await this.websocketManager.connect();
    } catch (err) {
      console.error('DDB Sync | Failed to connect:', err);
      ui.notifications.error('DDB Sync: Failed to connect to D&D Beyond. Check console for details.');
    }
  }

  disconnect() {
    if (this.websocketManager) {
      this.websocketManager.disconnect();
      this.websocketManager = null;
    }
  }

  /**
   * Handle incoming messages from DDB
   * Uses message dispatcher pattern for extensibility
   */
  async handleDDBMessage(message) {
    try {
      // Create a unique key for this message
      const messageKey = this.createMessageKey(message);

      // Check for duplicates
      if (this.messageDeduplicator.isProcessed(messageKey)) {
        console.log('DDB Sync | Skipping duplicate message');
        return;
      }

      // Mark message as processed
      this.messageDeduplicator.markProcessed(messageKey);

      // Dispatch to appropriate handler
      await this.messageDispatcher.dispatch(message);
    } catch (err) {
      console.error('DDB Sync | Error handling message:', err);
    }
  }

  /**
   * Create a unique key for a message based on its content
   * @private
   */
  createMessageKey(message) {
    const characterId = message.data?.character?.id || message.character?.id || message.characterId || 'unknown';
    const eventType = message.eventType || message.type || 'unknown';
    const messageId = message.id || message.messageId || message.rollId || '';
    return `${characterId}-${eventType}-${messageId}`;
  }

  handleCookieExpired() {
    console.warn('DDB Sync | CobaltSession cookie has expired or is invalid');
    ui.notifications.error('DDB Sync: Your CobaltSession cookie has expired. Please update it in the module settings.');

    // Create a dialog prompting the user to update the cookie
    new Dialog({
      title: 'D&D Beyond Cookie Expired',
      content: `
        <p>Your D&D Beyond CobaltSession cookie has expired or is invalid.</p>
        <p><strong>To get a new cookie:</strong></p>
        <ol>
          <li>Log into D&D Beyond in your browser</li>
          <li>Open DevTools (F12 or right-click → Inspect)</li>
          <li>Go to Application → Cookies → dndbeyond.com</li>
          <li>Find and copy the "CobaltSession" cookie value</li>
          <li>Paste it into the DDB Sync module settings</li>
          <li>Click "Reconnect" in the module settings</li>
        </ol>
      `,
      buttons: {
        open_settings: {
          label: 'Open Settings',
          callback: () => {
            // Open module settings
            game.settings.sheet.render(true);
          }
        },
        close: {
          label: 'Close'
        }
      },
      default: 'open_settings'
    }).render(true);

    // Disconnect to prevent repeated failed auth attempts
    this.disconnect();
  }

  reconnectWebSocket() {
    const enabled = game.settings.get(DDBSyncManager.ID, 'enabled');
    if (enabled) {
      this.disconnect();
      this.connect();
    }
  }
}
