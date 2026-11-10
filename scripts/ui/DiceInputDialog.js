import { DiceExtractor } from '../dice/DiceExtractor.js';

/**
 * DiceInputDialog - UI service for dice input prompts
 * Responsibility: Handle all UI dialogs for manual and DDB dice entry
 * SOLID: Single Responsibility - only handles dice input UI concerns
 */
export class DiceInputDialog {
  /**
   * @param {DiceRollMessageHandler} [diceRollMessageHandler] - Optional handler for DDB roll messages
   * @param {DiceExtractor} [diceExtractor] - Optional dice extractor service
   */
  constructor(diceRollMessageHandler = null, diceExtractor = null) {
    this.diceRollMessageHandler = diceRollMessageHandler;
    this.diceExtractor = diceExtractor || new DiceExtractor();
    this.logger = console;
  }

  /**
   * Set the dice roll message handler (for dependency injection)
   * @param {DiceRollMessageHandler} handler
   */
  setDiceRollMessageHandler(handler) {
    this.diceRollMessageHandler = handler;
  }

  /**
   * Set the dice extractor (for dependency injection)
   * @param {DiceExtractor} extractor
   */
  setDiceExtractor(extractor) {
    this.diceExtractor = extractor;
  }

  /**
   * Prompt the user to enter manual dice results
   * @param {string} formula - The roll formula (e.g., "2d6 + 4")
   * @param {Array} diceTerms - Array of Die terms from the roll
   * @returns {Array|null} Array of dice results or null if cancelled
   */
  async promptForManualDice(formula, diceTerms) {
    return new Promise((resolve) => {
      const content = this._buildDialogContent(formula, diceTerms, false);
      const rollButton = {
        action: 'roll',
        icon: 'fas fa-dice',
        label: "Use These Results",
        default: true,
        disabled: true, // Start disabled until all inputs are valid
        callback: (event, button, dialog) => {
          const results = this._extractResultsFromForm(button.form, diceTerms);
          resolve(results);
        }
      };
      const cancelButton = {
        action: 'cancel',
        icon: 'fas fa-times',
        label: "Roll Normally",
        callback: () => resolve(null)
      };
      const options = {
        window: {
          title: "Manual Dice Entry",
          classes: ["ddb-manual-dice-dialog"]
        },
        content: content,
        buttons: [rollButton, cancelButton],
        close: () => resolve(null) //TODO: close handler not called
      };
      new foundry.applications.api.DialogV2(options)
        .render({ force: true })
        .then((dialog) => this._setupInputValidation(dialog.window?.content, diceTerms));
    });
  }

  /**
   * Prompt the user for DDB dice results
   * @param {string} formula - The roll formula (e.g., "2d6 + 4")
   * @param {Array} diceTerms - Array of Die terms from the roll
   * @param {string} rollType - The type of roll
   * @param {Actor} actor - The actor making the roll
   * @param {string} itemName - The name of the item being used
   * @returns {Array|null} Array of dice results or null if cancelled
   */
  async promptForDDBDice(formula, diceTerms, rollType, actor, itemName) {
    // Check for cached roll first (from DDB roll that arrived before dialog opened)
    const ddbCharacterId = actor?.getFlag('ddb-sync', 'ddbCharacterId');
    if (ddbCharacterId && itemName && this.diceRollMessageHandler) {
      const cached = this.diceRollMessageHandler.getCachedRoll(ddbCharacterId, itemName);
      if (cached) {
        this.logger.log(`DDB Sync | Using cached roll for ${itemName}`);
        const diceResults = this._extractDDBDiceResultsForTerms(cached.rollData, diceTerms);
        // Convert to the expected format
        return diceTerms.map((term, termIndex) => ({
          dieType: `d${term.faces}`,
          count: term.number,
          results: diceResults[termIndex] || []
        }));
      }
    }
    return new Promise((resolve) => {
      const content = this._buildDialogContent(formula, diceTerms, true);
      let subscriptionId = null;
      const rollButton = {
        action: 'roll',
        icon: 'fas fa-dice',
        label: "Use These Results",
        default: true,
        disabled: true, // Start disabled until DDB roll is received
        callback: (event, button, dialog) => {
          this._cleanupDDBListener(subscriptionId);
          const results = this._extractResultsFromForm(button.form, diceTerms);
          resolve(results);
        }
      };
      const cancelButton = {
        action: 'cancel',
        icon: 'fas fa-times',
        label: "Roll Normally",
        callback: () => {
          this._cleanupDDBListener(subscriptionId);
          resolve(null);
        }
      };
      
      const options = {
        window: {
          title: "D&D Beyond Dice Entry",
          classes: ["ddb-dice-dialog"]
        },
        content: content,
        buttons: [rollButton, cancelButton],
        close: () => {
          this._cleanupDDBListener(subscriptionId); //TODO: close handler not called
          resolve(null);
        }
      };
      new foundry.applications.api.DialogV2(options)
        .render({ force: true })
        .then((dialog) => {
          const html = dialog.window?.content;
          // Set up listener for DDB roll messages
          subscriptionId = this._setupDDBRollListener(html, diceTerms, actor, itemName);
        });
    });
  }

  /**
   * Set up input validation for manual dice entry
   * Enables/disables the roll button based on input validity
   * @param {HTMLElement} html - The dialog HTML element
   * @param {Array} diceTerms - Array of Die terms
   * @private
   */
  _setupInputValidation(html, diceTerms) {
    const form = html?.querySelector('form');
    const inputs = form?.querySelectorAll('input[type="number"]') || [];
    // DialogV2 renders buttons in a separate footer, so we need to find the dialog root
    const dialogElement = form?.closest('.application') || html.closest?.('.application') || html;
    const rollButton = dialogElement.querySelector('button[data-action="roll"]');
    const validateInputs = () => {
      let allValid = true;
      inputs.forEach((input) => {
        const value = parseInt(input.value);
        const min = parseInt(input.min);
        const max = parseInt(input.max);
        if (isNaN(value) || value < min || value > max) {
          allValid = false;
          input.classList.add('invalid');
        } else {
          input.classList.remove('invalid');
        }
      });
      if (rollButton) {
        rollButton.disabled = !allValid;
      }
    };
    // Add listeners to all inputs
    inputs.forEach((input) => {
      input.addEventListener('input', validateInputs);
      input.addEventListener('change', validateInputs);
    });
    // Initial validation
    validateInputs();
  }

  /**
   * Set up listener for incoming DDB roll messages
   * @param {HTMLElement} html - The dialog HTML element
   * @param {Array} diceTerms - Array of Die terms expected
   * @param {Actor} actor - The actor making the roll
   * @param {string} itemName - The name of the item being used
   * @returns {string|null} Subscription ID for cleanup, or null if using legacy method
   * @private
   */
  _setupDDBRollListener(html, diceTerms, actor, itemName) {
    const form = html?.querySelector('form');
    // DialogV2 renders buttons in a separate footer, so we need to find the dialog root
    const dialogElement = form?.closest('.application') || html.closest?.('.application') || html;
    const rollButton = dialogElement.querySelector('button[data-action="roll"]');
    const statusEl = form?.querySelector('.ddb-roll-status');
    // Get DDB character ID for filtering
    const ddbCharacterId = actor?.getFlag('ddb-sync', 'ddbCharacterId');
    // Use the DiceRollMessageHandler if available (preferred approach)
    if (this.diceRollMessageHandler) {
      return this.diceRollMessageHandler.subscribe({
        once: true,
        handler: (rollData, message) => {
          // Verify the roll matches the expected actor (by DDB entity ID)
          const messageEntityId = rollData.context?.entityId || rollData.entityId;
          if (ddbCharacterId && messageEntityId && String(ddbCharacterId) !== String(messageEntityId)) {
            return false; // Roll is for a different character, don't consume
          }
          // Check if the dice in the roll match what we expect
          if (!this._doesRollMatchExpected(rollData, diceTerms)) {
            return false; // Roll doesn't match, don't consume
          }
          // Extract dice values and populate inputs
          const diceResults = this._extractDDBDiceResultsForTerms(rollData, diceTerms);
          this._populateInputsWithResults(form, diceTerms, diceResults);
          // Enable inputs and roll button
          const inputs = form?.querySelectorAll('input[type="number"]') || [];
          inputs.forEach(input => input.disabled = false);
          if (rollButton) {
            rollButton.disabled = false;
          }
          // Update status message
          if (statusEl) {
            statusEl.textContent = ' Roll received from D&D Beyond!';
            statusEl.classList.add('success');
          }
          return true; // Consumed the roll
        }
      });
    }
  }

  /**
   * Clean up the DDB message listener
   * @param {string|Object|null} subscriptionOrHandler - Subscription ID or legacy handler object
   * @private
   */
  _cleanupDDBListener(subscriptionOrHandler) {
    if (!subscriptionOrHandler) return;
    // New approach: unsubscribe by ID
    if (typeof subscriptionOrHandler === 'string' && this.diceRollMessageHandler) {
      this.diceRollMessageHandler.unsubscribe(subscriptionOrHandler);
      return;
    }
    // Legacy approach: remove event listener
    if (subscriptionOrHandler._legacyHandler) {
      const ddbSync = game.modules.get('ddb-sync')?.api;
      if (ddbSync?.websocketManager) {
        ddbSync.websocketManager.removeEventListener('message', subscriptionOrHandler._legacyHandler);
      }
    }
  }

  /**
   * Check if a DDB roll matches the expected dice terms
   * Uses DiceExtractor to parse the roll data
   * @param {Object} rollData - The roll data from DDB
   * @param {Array} diceTerms - Expected dice terms
   * @returns {boolean} True if the roll matches
   * @private
   */
  _doesRollMatchExpected(rollData, diceTerms) {
    // Use DiceExtractor to get the extracted dice results
    const extractedResults = this.diceExtractor.extractDiceResults(rollData);
    if (extractedResults.length === 0) return false;

    // Build expected dice signature
    const expectedDice = {};
    diceTerms.forEach(term => {
      const dieType = `d${term.faces}`;
      expectedDice[dieType] = (expectedDice[dieType] || 0) + term.number;
    });

    // Build actual dice signature from extracted results
    const actualDice = {};
    extractedResults.forEach(result => {
      const dieType = result.dieType;
      const count = result.results?.length || result.count || 0;
      actualDice[dieType] = (actualDice[dieType] || 0) + count;
    });

    // Compare signatures
    const expectedKeys = Object.keys(expectedDice).sort();
    const actualKeys = Object.keys(actualDice).sort();
    if (expectedKeys.length !== actualKeys.length) return false;
    return expectedKeys.every(key => expectedDice[key] === actualDice[key]);
  }

  /**
   * Extract dice results from DDB roll data and match to expected dice terms
   * Uses DiceExtractor for the actual extraction
   * @param {Object} rollData - The roll data from DDB
   * @param {Array} diceTerms - Expected dice terms
   * @returns {Array} Array of dice result arrays matching diceTerms order
   * @private
   */
  _extractDDBDiceResultsForTerms(rollData, diceTerms) {
    const results = [];
    
    // Use DiceExtractor to get all dice results
    const extractedResults = this.diceExtractor.extractDiceResults(rollData);
    
    // Flatten all dice into a pool organized by die type
    const dicePool = {};
    extractedResults.forEach(group => {
      const dieType = group.dieType;
      if (!dicePool[dieType]) {
        dicePool[dieType] = [];
      }
      dicePool[dieType].push(...group.results);
    });

    // Match dice to expected terms
    diceTerms.forEach(term => {
      const dieType = `d${term.faces}`;
      const termResults = [];
      const availableDice = dicePool[dieType] || [];
      
      for (let i = 0; i < term.number; i++) {
        if (availableDice.length > 0) {
          termResults.push(availableDice.shift());
        } else {
          termResults.push(1); // Fallback if not enough dice
        }
      }
      results.push(termResults);
    });

    return results;
  }

  /**
   * Populate form inputs with dice results
   * @param {HTMLFormElement} form - The form element
   * @param {Array} diceTerms - Dice terms
   * @param {Array} diceResults - Array of result arrays
   * @private
   */
  _populateInputsWithResults(form, diceTerms, diceResults) {
    if (!form) return;
    diceTerms.forEach((term, termIndex) => {
      const termResults = diceResults[termIndex] || [];
      for (let i = 0; i < term.number; i++) {
        const input = form.querySelector(`input[name="die-${termIndex}-${i}"]`);
        if (input && termResults[i] !== undefined) {
          input.value = termResults[i];
        }
      }
    });
  }

  /**
   * Build the dialog content HTML
   * @param {string} formula - The roll formula
   * @param {Array} diceTerms - Array of Die terms
   * @param {boolean} disabled - Whether inputs should be disabled
   * @returns {string} HTML content
   * @private
   */
  _buildDialogContent(formula, diceTerms, disabled = false) {
    const statusMessage = disabled ?
      '<p class="ddb-roll-status" style="margin-bottom: 15px; font-style: italic; color: #666;">Waiting for roll from D&D Beyond...</p>' :
      '<p style="margin-bottom: 15px; font-style: italic;">Enter your physical dice results below:</p>';
    let content = `<form class="ddb-manual-dice-form">
      <p style="margin-bottom: 10px;"><strong>Formula:</strong> ${formula}</p>
      ${statusMessage}`;
    diceTerms.forEach((term, termIndex) => {
      const dieType = `d${term.faces}`;
      const dieCount = term.number;
      content += `<div class="form-group" style="margin-bottom: 10px;">
        <label style="font-weight: bold;">${dieCount}${dieType}:</label>
        <div style="display: flex; gap: 5px; flex-wrap: wrap;">`;
      for (let i = 0; i < dieCount; i++) {
        content += `<input type="number"
                          name="die-${termIndex}-${i}"
                          min="1"
                          max="${term.faces}"
                          placeholder="${dieType}"
                          style="width: 60px; text-align: center;"
                          ${disabled ? 'disabled' : ''}
                          required />`;
      }
      content += `</div></div>`;
    });
    content += `</form>`;
    return content;
  }

  /**
   * Extract dice results from the dialog form
   * @param {HTMLFormElement} form - The dialog form element
   * @param {Array} diceTerms - Array of Die terms
   * @returns {Array} Array of dice result objects
   * @private
   */
  _extractResultsFromForm(form, diceTerms) {
    const results = [];
    diceTerms.forEach((term, termIndex) => {
      const dieResults = [];
      for (let i = 0; i < term.number; i++) {
        const input = form.querySelector(`input[name="die-${termIndex}-${i}"]`);
        const value = parseInt(input?.value) || 1;
        // Clamp value to valid range
        dieResults.push(Math.max(1, Math.min(term.faces, value)));
      }

//      dieResults.sort((a, b) => a - b); // Sort results ascending

      results.push({
        dieType: `d${term.faces}`,
        count: term.number,
        results: dieResults
      });
    });
    return results;
  }
}
