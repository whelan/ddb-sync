import { IMessageHandler } from '../interfaces/IMessageHandler.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Dice Roll Message Handler
 * Responsibility: Handle dice roll messages from DDB WebSocket
 * SOLID: Single Responsibility - only processes dice roll messages
 * Pattern: Observer - notifies subscribers when matching rolls arrive
 */
export class DiceRollMessageHandler extends IMessageHandler {
  constructor(characterMapper = null, diceRollHandler = null) {
    super();
    this.logger = Logger;
    this.characterMapper = characterMapper;
    this.diceRollHandler = diceRollHandler;
    // Subscribers waiting for specific roll types
    this.pendingRollCallbacks = [];
    // Cache for rolls that arrive before a dialog is ready
    this.cachedRolls = new Map();

    this.processingRolls = new Set();
  }

  /**
   * Set the character mapper (for dependency injection)
   * @param {CharacterMapper} mapper
   */
  setCharacterMapper(mapper) {
    this.characterMapper = mapper;
  }

  /**
   * Set the dice roll handler (for dependency injection)
   * @param {DiceRollHandler} handler
   */
  setDiceRollHandler(handler) {
    this.diceRollHandler = handler;
  }

  /**
   * Check if this handler can process the message
   * @param {Object} message - The DDB message
   * @returns {boolean}
   */
  canHandle(message) {
    const messageType = message.eventType;
    return messageType === 'dice/roll/fulfilled';
  }

  /**
   * Process the dice roll message
   * @param {Object} message - The DDB message
   * @returns {Promise<void>}
   */
  async handle(message) {
    const rollData = message.data || message;
    this.logger.log('DDB Sync | DiceRollMessageHandler received roll:', rollData);

    // Notify all pending callbacks and let them decide if the roll matches
    const callbacks = [...this.pendingRollCallbacks];
    let consumed = false;
    
    for (const callback of callbacks) {
      try {
        const result = await callback.handler(rollData, message);
        if (result && callback.once) {
          this.unsubscribe(callback.id);
        }
        if (result) {
          consumed = true;
        }
      } catch (err) {
        this.logger.error('DDB Sync | Error in roll callback:', err);
      }
    }

    // If no subscriber consumed the roll, route to appropriate handler
    if (!consumed) {
      const rollType = rollData.rolls?.[0]?.rollType;
      
      if (this.diceRollHandler && rollType) {
        const entityId = rollData.context?.entityId || rollData.entityId;
        const actor = this._findActorByDDBId(entityId);
        const action = rollData.action;

        if (actor) {
          const rollKey = `${entityId}-${action}-${rollData.rollId}`;
          
          if (this.processingRolls.has(rollKey)) {
            this.logger.log('DDB Sync | Already processing roll, skipping:', rollKey);
            return;
          }

          this.processingRolls.add(rollKey);

          try {
            this.logger.log(`DDB Sync | Routing ${rollType} roll to DiceRollHandler for ${actor.name}`);
            await this.diceRollHandler.handleRoll(actor, rollData, this);
          } catch (err) {
            this.logger.error(`DDB Sync | Error calling with handler`, err);
          } finally {
            // Clear processing flag after a delay to allow the roll to complete
            setTimeout(() => {
              this.processingRolls.delete(rollKey);
            }, 5000);
          }
        }
      }
    }
  }

  /**
   * Find a Foundry actor by DDB character ID
   * @param {string} ddbCharacterId - The DDB character ID
   * @returns {Actor|null}
   * @private
   */
  _findActorByDDBId(ddbCharacterId) {
    if (!ddbCharacterId) return null;
    
    // Try using the character mapper if available
    if (this.characterMapper) {
      return this.characterMapper.getFoundryActor(ddbCharacterId);
    }

    // Fallback: search all actors for one with matching DDB ID flag
    return game.actors.find(a => 
      String(a.getFlag('ddb-sync', 'ddbCharacterId')) === String(ddbCharacterId)
    );
  }

  /**
   * Cache a roll for later use by DiceInputDialog
   * @param {string} entityId - The DDB character ID
   * @param {string} action - The action name
   * @param {Object} rollData - The roll data
   * @param {Object} message - The original message
   */
  _cacheRoll(entityId, action, rollData, message) {
    const cacheKey = `${entityId}-${action.toLowerCase()}`;
    this.cachedRolls.set(cacheKey, {
      rollData,
      message,
      timestamp: Date.now()
    });
    this.logger.log(`DDB Sync | Cached roll for ${cacheKey}`);

    // Auto-expire cache after 30 seconds
    setTimeout(() => {
      if (this.cachedRolls.has(cacheKey)) {
        this.cachedRolls.delete(cacheKey);
        this.logger.log(`DDB Sync | Expired cached roll for ${cacheKey}`);
      }
    }, 30000);
  }

  cacheRollForHandler(rollData, handler) {
    const entityId = rollData.context?.entityId || rollData.entityId;
    const action = rollData.action;
    this._cacheRoll(entityId, action, rollData, null);
  }

  /**
   * Get and consume a cached roll
   * @param {string} entityId - The DDB character ID
   * @param {string} action - The action name
   * @returns {Object|null} The cached roll data or null
   */
  getCachedRoll(entityId, action) {
    const cacheKey = `${entityId}-${action.toLowerCase()}`;
    const cached = this.cachedRolls.get(cacheKey);
    
    if (cached) {
      this.cachedRolls.delete(cacheKey);
      this.logger.log(`DDB Sync | Retrieved cached roll for ${cacheKey}`);
      return cached;
    }
    
    return null;
  }

  /**
   * Check if there's a cached roll available
   * @param {string} entityId - The DDB character ID  
   * @param {string} action - The action name
   * @returns {boolean}
   */
  hasCachedRoll(entityId, action) {
    const cacheKey = `${entityId}-${action.toLowerCase()}`;
    return this.cachedRolls.has(cacheKey);
  }

  /**
   * Subscribe to receive dice roll notifications
   * @param {Object} options - Subscription options
   * @param {Function} options.handler - Callback function(rollData, message) => boolean (return true if consumed)
   * @param {string} [options.actorId] - Optional actor ID to filter by
   * @param {Array} [options.expectedDice] - Optional expected dice signature to match
   * @param {boolean} [options.once=false] - If true, unsubscribe after first match
   * @returns {string} Subscription ID for unsubscribing
   */
  subscribe(options) {
    const id = foundry.utils.randomID();
    this.pendingRollCallbacks.push({
      id,
      handler: options.handler,
      actorId: options.actorId,
      expectedDice: options.expectedDice,
      once: options.once ?? false
    });
    this.logger.log(`DDB Sync | Roll subscription added: ${id}`);
    return id;
  }

  /**
   * Unsubscribe from dice roll notifications
   * @param {string} subscriptionId - The subscription ID to remove
   */
  unsubscribe(subscriptionId) {
    const index = this.pendingRollCallbacks.findIndex(cb => cb.id === subscriptionId);
    if (index !== -1) {
      this.pendingRollCallbacks.splice(index, 1);
      this.logger.log(`DDB Sync | Roll subscription removed: ${subscriptionId}`);
    }
  }

  /**
   * Clear all subscriptions
   */
  clearSubscriptions() {
    this.pendingRollCallbacks = [];
  }
}
