# 0.0.16
- **Foundry v14 and dnd5e 6 only.** Foundry v13 and dnd5e 5.x and earlier are no longer supported; stay on 0.0.15 if you need them. All v13 / dnd5e ≤5 code paths are removed.
- Fixed: rolls for player-owned actors were not forced public on Foundry v14. v14 ignores the old `rollMode: 'publicroll'` option; the module now passes `messageMode: 'public'` to core `Roll#toMessage` and the v14 message mode (`'public'`) to dnd5e's `rollMode` message configs (spell cards, death saves). GM-only actors still follow the GM's chat mode dropdown.
- Spell slots spent on D&D Beyond are announced in Foundry chat (settings `Notify Spell Slots` and `GM only`). Skipped when a spell card was just posted for that actor.
- Spell rolls from D&D Beyond post the spell's dnd5e card once per cast (setting `postSpellCards`). Nothing is consumed or rolled.
- Area spells get a "Place template" button on the card for the GM and the actor's owners. Placement uses dnd5e 6's `TemplatePlacement`, which creates Regions; the old MeasuredTemplate / AbilityTemplate path and pre-activity item targets are gone. Placed areas are removed at the next turn or round, or when combat ends (setting `spellTemplateCleanup`, default: round).
- Death saves use dnd5e 6's `rollDeathSave(config, dialog, message)` signature only.
- The "cookie expired" prompt uses `DialogV2`; jQuery fallbacks in the dice mode selector and dice input dialog are removed (v14 passes HTMLElements).

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
