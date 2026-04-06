# 0.0.7
- Thanks to unnamedjk. Now supports username/password htauth for custom proxies
- Thanks to unnamedjk. Has cleaner order for Attack and Damage handler matching before the generic fallback

# 0.0.6

- Only process DDB messages on GM account.  Prevents issue with multiple rolls being performed.  Refactored main.js initialize into ready hook so we know if user is GM or not.
- Fixed syntax issue with MessageDeduplicator.test.js

# 0.0.5

- Initial Alpha Release
- Settings Registration
- Character Mapping Application launched from settings
- Dice mode selection on actor sheet
- Connetion to DDB Proxy
- WebSocket connection to D&D Beyond
- Handle character update message to apply health changes
- Override dice rolls to allow for manual input
- Override dice rolls to process DDB dice rolls
- UI to either prompt for manual dice rolls or await ddb dice rolls
- Initiative Dice Roll Handler
- Attack Dice Roll Handler; use item if found and UI not waiting for ddb dice roll already
- Save and Ability Dice Roll Handler
