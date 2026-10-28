# 0.0.15
- Death saving throws rolled on D&D Beyond now show up in Foundry. They were sent as a "save" with action "Death", which the saving-throw handler couldn't map to an ability and dropped. They now go through dnd5e's own death save roll with the D&D Beyond dice, so the actor's death save successes/failures (and nat 1 / nat 20) update in Foundry too.

# 0.0.14
- Conditions set on a D&D Beyond character sheet now sync to the mapped Foundry actor, including exhaustion levels. Conditions cleared on D&D Beyond are cleared in Foundry. Only the 15 core 5e conditions are touched; other status effects (concentration, GM markers, other modules') are left alone. New world setting: `Update Character Conditions From D&D Beyond` (on by default).
- Character updates are now handled by one `CharacterUpdateMessageHandler` that fetches the character from the proxy once and feeds every sync service (HP, conditions), instead of one fetch per sync. Replaces `DamageMessageHandler`.
- The existing `Update Character Damage From D&D Beyond` setting is now actually honoured — it was registered but never read, so HP always synced regardless of the checkbox.

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
