# DDB Sync Module

![Latest Release Download Count](https://img.shields.io/badge/dynamic/json?label=Downloads%20(Latest)&query=assets%5B0%5D.download_count&url=https%3A%2F%2Fapi.github.com%2Frepos%2FAshDarkley%2Fddb-sync%2Freleases%2Flatest)
![Foundry Minimum Compatible Version](https://img.shields.io/badge/dynamic/json.svg?url=https%3A%2F%2Fraw.githubusercontent.com%2FAshDarkley%2Fddb-sync%2Fmain%2Fmodule.json&label=Foundry%20Version&query=$.compatibility.minimum&colorB=orange)
![Foundry Verified Compatible Version](https://img.shields.io/badge/dynamic/json.svg?url=https%3A%2F%2Fraw.githubusercontent.com%2FAshDarkley%2Fddb-sync%2Fmain%2Fmodule.json&label=Foundry%20Version&query=$.compatibility.verified&colorB=green)

A Foundry VTT module that synchronizes D&D Beyond dice rolls and character health with Foundry VTT in real-time.  No browser extensions needed!

## Patreon

Full functionality of this module is freely available.  However, if you like it please consider providing support.  Any you can give is greatly appreciated.  [Patreon](https://patreon.com/ashdarkley)

## Overview

DDB Sync listens for messages from D&D Beyond and dispatches them to specialized handlers to:
- Capture and apply dice rolls to Foundry actors (Attack, Damage, Save, Abilitiy Check, Initiative, Generic Roll)
- Sync HP/damage updates from D&D Beyond to mapped Foundry actor without overwriting unrelated character data
- Sync conditions (including exhaustion levels) a player sets on their D&D Beyond sheet to the mapped Foundry actor
- Post a spell's card to chat when a D&D Beyond roll belongs to a spell (once per cast), with a "Place template" button for area spells and optional template cleanup on the next turn or round
- Answer Monk's TokenBar "Request Roll" cards (saves, ability and skill checks, death saves, initiative) with D&D Beyond rolls: the player is whispered to roll on D&D Beyond and the result lands in the card as that token's roll (setting `monksTokenBarRequests`)
- Provides a UI for mapping D&D Beyond characters to Foundry actors
- On Foundry Player Actor sheet provides a dropdown to select dice behavior (Normal, Manual, D&D Beyond)

## System Requirements
- **Foundry VTT**: Version 14 (verified on v14). Foundry v13 is no longer supported; stay on ddb-sync 0.0.15 for v13.
- **D&D 5e System**: Version 6.x (verified on 6.1). Required for character and ability mapping, spell cards and spell areas. dnd5e 5.x and earlier are no longer supported.
- **DDB Proxy**: Required to proxy requests to D&D Beyond.  Must be your own install and not Mr Primates hosted version as this require a small change to the proxy to function correctly. 

## IMPORTANT! REQUIRES: custom DDB Proxy
- **DDB Proxy** - A proxy server for D&D Beyond API Access
  - GitHub: [ddb-proxy repository](https://github.com/MrPrimate/ddb-proxy)
  - The proxy intercepts D&D Beyond API calls and provides authenticated access 

**IMPORTANT**: The DDB Proxy requires a manual configuration change before use.

1. Set up the DDB Proxy server from the repository
2. Open the proxy's `index.js` file
3. Locate the `/proxy/auth` endpoint
4. Modify the auth response to include the token:
    ```javascript
    // Find this section in index.js under the line that reads: const authPath = ["/proxy/auth"];:
    return res.status(200).json({ success: true, message: "Authenticated." });
    
    //update it to read this instead:
    return res.status(200).json({ success: true, message: "Authenticated.", token: token });
    ```

  SCREENSHOT:
    ![DDB Proxy Edit Location](ddb-proxy-mod.png)
5. Restart the proxy server

This ensures the module can receive the authentication token needed for subsequent API calls.


## Key Capabilities
- Real-time WebSocket listener with reconnection handling (`websocket/DDBWebSocket.js`)
- Message deduplication to prevent duplicate processing (`websocket/MessageDeduplicator.js`)
- Service layer for fetching and mapping character data (`core/services/`)
- Multiple roll handlers for attack, damage, saves, ability checks, and initiative (`dice/handlers/`)
- Settings-driven behavior and a character-mapping UI for manual overrides (`config/SettingsRegistry.js`, `ui/CharacterMappingApplication.js`)

## Project Structure (high level)
- `module.json`, `package.json` — module metadata
- `scripts/main.js` — Foundry module bootstrap
- `core/` — central manager (`DDBSyncManager.js`), handlers, services and validators
- `dice/` — extraction, builders, strategies and handlers for roll types
- `websocket/` — WebSocket handling and deduplication
- `ui/`, `templates/` — mapping UI and templates
- `examples/` — sample D&D Beyond payloads used for testing

## Architecture & Flow

1. `websocket/DDBWebSocket.js` receives incoming messages.
2. `websocket/MessageDeduplicator.js` filters out already-seen messages.
3. `core/MessageDispatcher.js` routes messages to a handler in `core/handlers/` or `dice/handlers/`.
4. Handlers call service layer functions (`core/services/*`) to apply changes to Foundry actors.

This separation keeps message handling, business logic, and Foundry integration cleanly separated and easy to extend.

## Configuration
Configure settings via the module settings (registered in `config/SettingsRegistry.js`):
1. **CobaltSession Cookie** (`cobaltCookie`)
    - Your D&D Beyond authentication cookie
    - Find in browser DevTools > Application > Cookies > D&D Beyond site
    - Copy the value of the `CobaltSession` cookie

2. **Cobalt User ID** (`userId`)
    - Your D&D Beyond user ID
    - Find in browser DevTools > Console > Type in: console.log(Cobalt.User.ID)
    - Copy the value

3. **Campaign ID** (`campaignId`)
    - The D&D Beyond campaign ID
    - Found in the campaign URL: `dndbeyond.com/campaigns/{campaignId}`

4. **Proxy Server URL** (`proxyUrl`)
    - Custom proxy server for API calls (default: `http://localhost:3000`)
    - Required, plus see note above about necessary customization

5. **Update Character Damage** (`updateDamageOnly`)
    - When enabled, character updates sync HP/damage changes (default: `true`)
    - When disabled, HP/damage changes are ignored

6. **Update Character Conditions** (`syncConditions`)
    - When enabled, conditions set on the D&D Beyond sheet are applied to the mapped
      Foundry actor, and conditions cleared on D&D Beyond are removed (default: `true`)
    - When disabled, condition changes are ignored

7. **Character Mapping** (`characterMapping`)
    - Mapping of D&D Beyond character IDs to Foundry actor IDs

8. **Enable DDB Dice Sync** (`captureRolls`)
    - Enable/disable automatic roll capture

Refer to `config/SettingsRegistry.js` for exact keys and defaults.

## Installation
1. (Easiest) Install from Foundry Install Module screen OR (Less easiest) download the release from this repo, and place the ddb-sync folder into Foundry's `modules` directory.
2. Ensure the proxy provides authenticated messages and is reachable via `proxyUrl`. See configuration needed above.
3. Enable the module in Foundry's Module Management.
4. Configure the module settings; start the proxy.

## Usage
- Use the `Character Mapping` UI to map DDB characters to Foundry actors and run manual syncs.
- Enable `captureRolls` to let the module automatically capture and apply relevant rolls.
- Toggle `updateDamageOnly` if you only want HP/damage changes applied automatically.
- Toggle `syncConditions` if you want conditions applied automatically.
- Open a player actor sheet and select desired dice mode: Normal, Manual, or D&D Beyond

### Condition sync
When a player sets or clears a condition on their D&D Beyond character sheet, the mapped
Foundry actor is brought in line with it:

- The 15 core 5e conditions are mirrored. D&D Beyond is the source of truth, so a condition
  cleared there is switched off in Foundry as well.
- Exhaustion is applied as a level (`system.attributes.exhaustion`), not as a plain on/off status.
- Any other status effect — a GM's `concentrating` or `dead` marker, statuses set by other
  modules — is never touched by the sync.
- Because D&D Beyond is authoritative, a condition the GM applies in Foundry alone is removed
  again the next time that character changes on D&D Beyond. Turn `syncConditions` off if you
  would rather manage conditions in Foundry.

## Troubleshooting
- Connection issues: verify `cobaltCookie`, `campaignId`, `proxyUrl` and check browser console logs for WebSocket errors.
- Missing rolls: ensure `captureRolls` is enabled and the DDB character is mapped to an actor.
- Duplicate events: consult the deduplication logic in `websocket/MessageDeduplicator.js` and increase window if upstream replays occur.

## Developer Notes
- Add a new roll type: implement a handler in `dice/handlers/` and register it with the dispatcher.
- Extend mapping logic: modify `core/services/CharacterMapper.js` and update `ui/CharacterMappingApplication.js`.

## Where to look in code
- Entry: `scripts/main.js`
- Core manager: `core/DDBSyncManager.js`
- WebSocket & dedupe: `websocket/DDBWebSocket.js`, `websocket/MessageDeduplicator.js`
- Services: `core/services/`
- Dice logic: `dice/`
- UI & templates: `ui/`, `templates/`

## License
MIT License
See `module.json` for license metadata.

## Support
Open an issue in the repo or contact the maintainer for feature requests and bug reports.




