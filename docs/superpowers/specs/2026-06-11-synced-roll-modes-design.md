# Synced Roll Modes — Design

**Date:** 2026-06-11
**Target:** Foundry VTT v13 (The Forge), dnd5e, ddb-sync module

> **Revision 2026-06-14 — discriminator changed from DDB userId to Foundry actor ownership.**
> Forge testing showed the original assumption was wrong for the user's workflow: the
> GM rolls every character from a single DDB account, so the game-log envelope `userId`
> is identical for every roll and cannot distinguish a player-character roll from the
> GM's own. The policy now keys off `actor.hasPlayerOwner` instead: rolls for
> player-owned actors are always public; rolls for GM-only actors (NPCs, monsters, the
> GM's own characters) follow the GM's roll-mode dropdown. The websocket no longer
> needs to carry `rollerUserId`. The sections below describe the original userId design;
> the live behavior is the ownership rule. See `scripts/dice/RollModePolicy.js`.

## Problem

All rolls synced from D&D Beyond are posted to Foundry chat by the GM's client via
`roll.toMessage({ flavor, speaker })` with no explicit roll mode. Two consequences:

1. The GM cannot hide their own synced rolls from players (DDB rolls must be public
   on DDB for the sync to receive them at all).
2. Latent bug: because no roll mode is passed, Foundry v13 falls back to the posting
   client's `core.rollMode` dropdown — so if the GM flips their chat dropdown to a
   hidden mode, *players'* synced rolls silently go hidden too.

## Requirements

- Rolls synced from the GM's DDB account follow the GM's Foundry chat roll-mode
  dropdown (Public Roll / Private GM Roll / Blind GM Roll / Self Roll), per roll.
- Rolls synced from any other DDB account are always posted as public, regardless
  of the GM's dropdown.
- Rolls stay public on the DDB side (players play exclusively through Foundry and
  do not watch the DDB game log — accepted).
- v13 API only. No version detection. (The legacy `rollMode` option remains
  functional on v14 via core's compatibility shim until v16, so a future Forge
  upgrade does not break this.)

## Design

### Change 1 — Preserve roller identity (websocket layer)

In `scripts/websocket/DDBWebSocket.js`, `onMessage`, case `'dice/roll/fulfilled'`:
the handler currently forwards only `message.data` (plus `eventType` and `id`),
discarding the envelope. Add:

```js
diceData.rollerUserId = message.userId ?? null;
```

The DDB game-log envelope carries the rolling user's DDB user id as `userId`.
The module already logs every raw websocket message to the console
(`DDB Sync | Message received:`), so the field's presence is confirmed with a
single test roll. If absent, behavior degrades safely (see Change 2).

### Change 2 — Roll mode policy (new helper)

New small file `scripts/dice/RollModePolicy.js` with one static method:

```js
static messageOptions(rollData)
```

- If `rollData.rollerUserId` matches the module's configured `userId` setting
  (the GM's DDB user id, compared as strings): return `{}`. Foundry v13's
  `Roll#toMessage` then applies the GM client's current `core.rollMode`
  dropdown value — its documented fallback behavior.
- Otherwise (different user, or `rollerUserId` missing/null): return
  `{ rollMode: 'publicroll' }`. When the id is missing, also log a console
  warning, since that means the DDB payload shape was unexpected. The safe
  default direction is public (today's behavior) — a player roll can never
  accidentally become hidden.

### Change 3 — Pass the policy at every chat post site

All 7 `roll.toMessage(...)` call sites in the six dice handlers
(`AttackRollHandler`, `DamageRollHandler`, `SaveRollHandler`,
`AbilityCheckRollHandler` ×2, `InitiativeRollHandler`, `GenericRollHandler`)
change from:

```js
await roll.toMessage({ flavor, speaker });
```

to:

```js
await roll.toMessage({ flavor, speaker }, RollModePolicy.messageOptions(rollData));
```

`rollData` is already in scope at every site. No handler signatures change.

## Behavior matrix

| Roller (DDB account) | GM dropdown        | Resulting chat message |
|----------------------|--------------------|------------------------|
| GM                   | Public Roll        | Public                 |
| GM                   | Private GM Roll    | Whispered to GM only   |
| GM                   | Blind GM Roll      | Whispered to GM only   |
| GM                   | Self Roll          | Visible to GM only     |
| Player               | any                | Public                 |
| Unknown (no userId)  | any                | Public + console warn  |

(All synced messages are authored by the GM client, so GM-whisper modes hide
them from all players.)

## Edge cases

- **Initiative:** the chat card respects the roll mode, but
  `InitiativeRollHandler` also writes the result to the combat tracker via
  `game.combat.setInitiative(...)`. Tracker visibility follows Foundry's normal
  rules (e.g. hidden tokens' combatants are hidden) — same as rolling hidden
  initiative natively. No special-casing.
- **Dialog-consumed rolls:** rolls consumed by `DiceInputDialog` /
  roll-subscription callbacks flow through Foundry's own roll dialogs, which
  have their own roll-mode select. Untouched.
- **HP / character-update sync:** unaffected; this design touches only the
  dice-roll path.
- **DDB game log:** rolls remain publicly visible on dndbeyond.com to anyone
  in the campaign who looks there. Accepted per requirements.

## Testing

- **Unit (jest, existing setup):** `RollModePolicy.messageOptions` —
  GM's id → `{}`; other id → `{ rollMode: 'publicroll' }`; missing id →
  `{ rollMode: 'publicroll' }` + warning; string/number id comparison.
- **Manual on the Forge (v13):**
  1. GM dropdown = Private GM Roll; roll on DDB as GM → message whispered to GM,
     invisible to a connected player.
  2. Player rolls on DDB while GM dropdown is still Private GM Roll → message
     public (verifies the latent-bug fix).
  3. GM dropdown = Public Roll; GM rolls → public.
  4. Confirm `message.userId` appears in the raw websocket console log.

## Out of scope

- Hiding rolls on the DDB side (self-rolls do not reach the campaign socket).
- Per-character hidden-roll flags in the mapping UI.
- The combat tracker value visibility for hidden initiative.
