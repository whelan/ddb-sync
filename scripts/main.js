// Main module file for DDB Dice Sync
import { CharacterMappingApplication } from './ui/CharacterMappingApplication.js';
import { DDBSyncManager } from './core/DDBSyncManager.js';
import { RollEvaluationOverride } from './core/overrides/RollEvaluationOverride.js';
import { DiceModeSelector } from './ui/DiceModeSelector.js';
import { DDBRollInjector } from './core/overrides/DDBRollInjector.js';

// Initialize on Foundry ready
Hooks.once('init', () => {

});

// Connect on Foundry ready if enabled
Hooks.once('ready', async () => {
  // Only GMs should initialize the DDB Sync Manager
  if (!game.user.isGM) return;

  DDBSyncManager.initialize();
  
  // Initialize Roll.prototype.evaluate override with shared DiceInputDialog
  const rollEvaluationOverride = new RollEvaluationOverride(
    game.DDBSync?.diceRollHandler,
    game.DDBSync?.diceInputDialog
  );
  rollEvaluationOverride.initialize();

  // dnd5e v5: inject DDB dice into the system's own D20Roll/DamageRoll classes.
  DDBRollInjector.install();
  globalThis.DDBSyncInjector = DDBRollInjector;

  const enabled = game.settings.get(DDBSyncManager.ID, 'enabled');
  if (enabled && game.DDBSync) {
    console.log('DDB Sync | Connecting on startup (enabled setting is true)');
    await game.DDBSync.connect();
  }
});

// Add dropdown to actor sheet for normal, manual, or ddb dice mode
const diceModeSelector = new DiceModeSelector();

Hooks.on('renderDocumentSheetV2', (app, html, data) => {
  // Check if the application is for an actor and is a character
  if (app.document?.documentName === 'Actor' && app.document?.type === 'character') {
    console.log('DDB Sync | renderDocumentSheetV2 hook fired for character sheet');
    diceModeSelector.renderDiceMode(app, html, data);
  }
});

// Hook to add button to settings for character mapping
Hooks.on('renderSettings', (app, html) => {
  if (!game.user.isGM) return;
  
  // Find the settings panel
  const settingsGame = html.querySelector('#settings-game');
  if (!settingsGame) return;
  
  // Add character mapping button
  const button = document.createElement('button');
  button.className = 'ddb-sync-settings-button';
  button.type = 'button';
  button.style.cssText = `
    padding: 8px 12px;
    background: rgba(0,0,0,0.15);
    border: 1px solid rgba(0,0,0,0.2);
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    margin: 5px;
    display: block;
    width: 100%;
    text-align: left;
  `;
  button.innerHTML = '<i class="fas fa-link"></i> D&D Beyond Character Mapping';
  
  button.addEventListener('click', (ev) => {
    ev.preventDefault();
    new CharacterMappingApplication().render(true);
  });
  
  if (settingsGame) {
    settingsGame.appendChild(button);
  }
});