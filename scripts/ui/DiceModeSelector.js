/**
 * DiceModeSelector - Manages dice mode dropdown UI on character sheets
 * 
 * Responsibilities:
 * - Render dice mode selector dropdown on character sheets
 * - Handle mode selection changes
 * - Update actor flags for dice mode preference
 * - Manage DOM element creation and insertion
 */
export class DiceModeSelector {
  /**
   * Render dice mode selector on character sheet
   * @param {Object} app - The sheet application
   * @param {HTMLElement} html - The app's HTML element
   * @param {Object} data - The app's data
   */
  renderDiceMode(app, html, data) {
    console.log('DDB Sync | renderDiceMode called', { app, html, data });

    const actor = app.actor || app.document;
    console.log('DDB Sync | Actor:', actor?.name, 'Type:', actor?.type);

    if (!actor || actor.type !== 'character') {
      console.log('DDB Sync | Skipping - not a character actor');
      return;
    }

    // Foundry v14 render hooks pass the application's HTMLElement
    const appElement = html;
    console.log('DDB Sync | App element found:', !!appElement);

    if (!appElement) {
      console.warn('DDB Sync | Could not find app element');
      return;
    }

    // Check if we already added the toggle (prevent duplicates)
    if (appElement.querySelector('.ddb-dice-mode-selector')) {
      console.log('DDB Sync | Selector already added, skipping');
      return;
    }

    // Get current dice mode
    const diceMode = actor.getFlag('ddb-sync', 'diceMode') || 'normal';
    console.log('DDB Sync | Dice mode:', diceMode);

    // Create selector element
    const diceModeSelector = this.createSelectorElement(diceMode);

    // Bind event handlers
    this.bindEventHandlers(diceModeSelector, actor);

    // Insert into sheet
    this.insertIntoSheet(appElement, diceModeSelector);
  }

  /**
   * Create the dice mode selector DOM element
   * @param {string} diceMode - Current dice mode
   * @returns {HTMLElement} - The selector element
   * @private
   */
  createSelectorElement(diceMode) {
    const diceModeSelector = document.createElement('div');
    diceModeSelector.className = 'ddb-dice-mode-selector';
    diceModeSelector.innerHTML = `
      <label style="display: flex; align-items: center; gap: 5px; padding: 4px 8px; background: rgba(0,0,0,0.15); border-radius: 3px; cursor: pointer; font-size: 11px; border: 1px solid rgba(0,0,0,0.2);">
        <i class="fas fa-dice" style="color: ${diceMode === 'normal' ? 'inherit' : diceMode === 'manual' ? '#4488ff' : '#44b944'};"></i>
        <select style="margin: 0; padding: 2px 4px; font-size: 11px; border-radius: 2px; border: 1px solid #666; background: white; color: #000; cursor: pointer;">
          <option value="normal" ${diceMode === 'normal' ? 'selected' : ''} style="background: white; color: #000;">Normal</option>
          <option value="manual" ${diceMode === 'manual' ? 'selected' : ''} style="background: white; color: #000;">Manual</option>
          <option value="ddb" ${diceMode === 'ddb' ? 'selected' : ''} style="background: white; color: #000;">D&D Beyond</option>
        </select>
      </label>
    `;

    return diceModeSelector;
  }

  /**
   * Bind event handlers to the selector element
   * @param {HTMLElement} diceModeSelector - The selector element
   * @param {Actor} actor - The actor document
   * @private
   */
  bindEventHandlers(diceModeSelector, actor) {
    const select = diceModeSelector.querySelector('select');
    const icon = diceModeSelector.querySelector('i');

    const updateIcon = (mode) => {
      if (mode === 'normal') {
        icon.style.color = 'inherit';
      } else if (mode === 'manual') {
        icon.style.color = '#4488ff';
      } else if (mode === 'ddb') {
        icon.style.color = '#44b944';
      }
    };

    select.addEventListener('change', async (event) => {
      event.stopPropagation();
      const mode = event.target.value;
      await actor.setFlag('ddb-sync', 'diceMode', mode);
      updateIcon(mode);
      const modeNames = { normal: 'Normal', manual: 'Manual', ddb: 'DDB' };
      ui.notifications.info(`Dice mode changed to ${modeNames[mode]} for ${actor.name}`);
    });

    diceModeSelector.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  }

  /**
   * Insert the selector into the sheet's window header
   * @param {HTMLElement} appElement - The app's root element
   * @param {HTMLElement} diceModeSelector - The selector element
   * @private
   */
  insertIntoSheet(appElement, diceModeSelector) {
    // Find the window header
    const windowHeader = appElement.querySelector('.window-header');
    console.log('DDB Sync | Window header found:', !!windowHeader);

    if (windowHeader) {
      // Insert before the close button
      const closeButton = windowHeader.querySelector('.header-button.close, .close, [data-action="close"]');
      console.log('DDB Sync | Close button found:', !!closeButton);
      if (closeButton) {
        closeButton.before(diceModeSelector);
      } else {
        windowHeader.appendChild(diceModeSelector);
      }
      diceModeSelector.style.marginRight = '5px';
      console.log('DDB Sync | Dice mode selector added to window header');
      return;
    }

    console.warn('DDB Sync | Could not find window header');
  }
}
