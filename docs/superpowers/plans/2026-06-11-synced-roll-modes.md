# Synced Roll Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rolls synced from the GM's D&D Beyond account follow the GM's Foundry roll-mode dropdown; rolls from any other DDB account always post publicly.

**Architecture:** Preserve the roller's DDB user id from the websocket envelope onto the dispatched roll data, resolve a `Roll#toMessage` options object in one new policy class (`{}` for the GM → Foundry v13 applies the `core.rollMode` dropdown; `{ rollMode: 'publicroll' }` for everyone else), and pass that object at all 7 chat-post call sites in the six dice handlers.

**Tech Stack:** Foundry VTT v13 API (`Roll#toMessage`, `core.rollMode`), ES modules, jest 30 (node, CommonJS).

**Spec:** `docs/superpowers/specs/2026-06-11-synced-roll-modes-design.md`

---

## File structure

| File | Change | Responsibility |
|------|--------|----------------|
| `scripts/dice/RollModePolicy.js` | **Create** | Decide `toMessage` options for a synced roll (GM follows dropdown, others forced public) |
| `tests/dice/RollModePolicy.test.js` | **Create** | Unit tests for the policy |
| `scripts/websocket/DDBWebSocket.js` | Modify (~line 150) | Copy `message.userId` → `diceData.rollerUserId` before dispatch |
| `scripts/dice/handlers/AttackRollHandler.js` | Modify (1 site) | Pass policy options to `toMessage` |
| `scripts/dice/handlers/DamageRollHandler.js` | Modify (1 site) | Pass policy options to `toMessage` |
| `scripts/dice/handlers/SaveRollHandler.js` | Modify (1 site) | Pass policy options to `toMessage` |
| `scripts/dice/handlers/AbilityCheckRollHandler.js` | Modify (2 sites) | Pass policy options to `toMessage` |
| `scripts/dice/handlers/InitiativeRollHandler.js` | Modify (1 site) | Pass policy options to `toMessage` |
| `scripts/dice/handlers/GenericRollHandler.js` | Modify (1 site) | Pass policy options to `toMessage` |

**Testing convention (important):** This repo's jest setup is CommonJS/node with no babel — it **cannot import** the Foundry ES modules in `scripts/`. The established convention (see `tests/dice/handlers/AttackRollHandler.test.js`) is that each test file contains an inline copy of the class under test. Follow it: the test file defines a mirror copy of `RollModePolicy` and the real module must match it exactly (modulo the `export` keyword). This means the classic red-green cycle is not achievable here; the test pins the contract and Step-type ordering below adapts accordingly. Do **not** restructure the test infra — out of scope.

**All six handlers** have the signature `async handle(actor, rollData)` (plus `AbilityCheckRollHandler._handleAbilityCheck(actor, rollData, abilityKey)`), so `rollData` is in scope at every call site.

---

### Task 1: RollModePolicy (tests + module)

**Files:**
- Create: `tests/dice/RollModePolicy.test.js`
- Create: `scripts/dice/RollModePolicy.js`

- [ ] **Step 1: Write the test file**

Create `tests/dice/RollModePolicy.test.js` with exactly:

```javascript
/**
 * RollModePolicy Tests
 *
 * Repo convention: jest (CommonJS, node env) cannot import the Foundry ES
 * modules in scripts/, so the class below is an inline mirror of
 * scripts/dice/RollModePolicy.js. If you change one, change both.
 */

class RollModePolicy {
  static logger = console;

  static messageOptions(rollData) {
    const rollerUserId = rollData?.rollerUserId;
    if (rollerUserId === null || rollerUserId === undefined) {
      this.logger.warn('DDB Sync | Roll arrived without a roller userId; posting publicly');
      return { rollMode: 'publicroll' };
    }
    const ownUserId = game.settings.get('ddb-sync', 'userId');
    if (String(rollerUserId) === String(ownUserId)) {
      // GM's own roll: let Foundry apply the current core.rollMode dropdown
      return {};
    }
    return { rollMode: 'publicroll' };
  }
}

describe('RollModePolicy', () => {
  beforeEach(() => {
    global.game = {
      settings: {
        get: jest.fn().mockReturnValue('1111111')
      }
    };
    RollModePolicy.logger = { warn: jest.fn() };
  });

  afterEach(() => {
    delete global.game;
    RollModePolicy.logger = console;
  });

  describe('messageOptions', () => {
    it('returns {} when the roller is the configured DDB user (string id)', () => {
      const result = RollModePolicy.messageOptions({ rollerUserId: '1111111' });
      expect(result).toEqual({});
    });

    it('returns {} when the roller id is a number and the setting is a string', () => {
      const result = RollModePolicy.messageOptions({ rollerUserId: 1111111 });
      expect(result).toEqual({});
    });

    it('forces publicroll for a different DDB user', () => {
      const result = RollModePolicy.messageOptions({ rollerUserId: '2222222' });
      expect(result).toEqual({ rollMode: 'publicroll' });
    });

    it('forces publicroll and warns when rollerUserId is missing', () => {
      const result = RollModePolicy.messageOptions({});
      expect(result).toEqual({ rollMode: 'publicroll' });
      expect(RollModePolicy.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('forces publicroll and warns when rollerUserId is null', () => {
      const result = RollModePolicy.messageOptions({ rollerUserId: null });
      expect(result).toEqual({ rollMode: 'publicroll' });
      expect(RollModePolicy.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('forces publicroll and warns when rollData itself is undefined', () => {
      const result = RollModePolicy.messageOptions(undefined);
      expect(result).toEqual({ rollMode: 'publicroll' });
      expect(RollModePolicy.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('forces publicroll when the userId setting is empty', () => {
      global.game.settings.get.mockReturnValue('');
      const result = RollModePolicy.messageOptions({ rollerUserId: '1111111' });
      expect(result).toEqual({ rollMode: 'publicroll' });
    });

    it('reads the userId setting from the ddb-sync module', () => {
      RollModePolicy.messageOptions({ rollerUserId: '1111111' });
      expect(global.game.settings.get).toHaveBeenCalledWith('ddb-sync', 'userId');
    });

    it('does not warn for a normal player roll', () => {
      RollModePolicy.messageOptions({ rollerUserId: '2222222' });
      expect(RollModePolicy.logger.warn).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npx jest tests/dice/RollModePolicy.test.js`
Expected: PASS, 9 tests. (The mirror copy makes these pass immediately — see Testing convention above. They exist to pin the contract.)

- [ ] **Step 3: Create the real module**

Create `scripts/dice/RollModePolicy.js` with exactly:

```javascript
/**
 * Roll Mode Policy
 * Responsibility: Decide the Foundry chat roll mode for synced DDB rolls
 * SOLID: Single Responsibility - only resolves Roll#toMessage options
 *
 * Rolls made by the configured DDB user (the GM) follow the GM client's
 * current core.rollMode dropdown (Foundry v13 applies it automatically when
 * no rollMode option is passed). Rolls from any other DDB user are always
 * posted publicly so the GM's dropdown can never hide a player's roll.
 *
 * NOTE: tests/dice/RollModePolicy.test.js contains a mirror copy of this
 * class (jest cannot import Foundry ES modules). Keep them in sync.
 */
export class RollModePolicy {
  static logger = console;

  /**
   * Resolve the options object for Roll#toMessage for a synced DDB roll.
   * @param {Object} rollData - Roll data dispatched from the websocket layer
   * @param {string|number|null} [rollData.rollerUserId] - DDB user id of the roller
   * @returns {Object} {} to follow the GM's roll-mode dropdown,
   *   or { rollMode: 'publicroll' } to force a public roll.
   */
  static messageOptions(rollData) {
    const rollerUserId = rollData?.rollerUserId;
    if (rollerUserId === null || rollerUserId === undefined) {
      this.logger.warn('DDB Sync | Roll arrived without a roller userId; posting publicly');
      return { rollMode: 'publicroll' };
    }
    const ownUserId = game.settings.get('ddb-sync', 'userId');
    if (String(rollerUserId) === String(ownUserId)) {
      // GM's own roll: let Foundry apply the current core.rollMode dropdown
      return {};
    }
    return { rollMode: 'publicroll' };
  }
}
```

- [ ] **Step 4: Verify the mirror copy matches**

Compare the class body in `scripts/dice/RollModePolicy.js` against the copy in `tests/dice/RollModePolicy.test.js`. They must be identical except for `export` and the doc comments. Then run the full suite:

Run: `npx jest`
Expected: PASS, no failures anywhere.

- [ ] **Step 5: Commit**

```bash
git add scripts/dice/RollModePolicy.js tests/dice/RollModePolicy.test.js
git commit -m "Add RollModePolicy for synced DDB roll visibility

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Preserve roller identity in the websocket layer

**Files:**
- Modify: `scripts/websocket/DDBWebSocket.js:150-156`

- [ ] **Step 1: Add rollerUserId to the dispatched dice data**

In `scripts/websocket/DDBWebSocket.js`, inside `onMessage`, find:

```javascript
        case 'dice/roll/fulfilled':
          // Preserve eventType in the data so handleDDBMessage can recognize it
          const diceData = message.data || message;
          diceData.eventType = message.eventType;
          diceData.id = message.rollId;
          this.dispatchEvent(new CustomEvent('message', { detail: diceData }));
          break;
```

Replace with:

```javascript
        case 'dice/roll/fulfilled':
          // Preserve eventType in the data so handleDDBMessage can recognize it
          const diceData = message.data || message;
          diceData.eventType = message.eventType;
          diceData.id = message.rollId;
          // The envelope's userId identifies the roller; RollModePolicy needs it
          diceData.rollerUserId = message.userId ?? null;
          this.dispatchEvent(new CustomEvent('message', { detail: diceData }));
          break;
```

- [ ] **Step 2: Run the test suite (regression)**

Run: `npx jest`
Expected: PASS. (No unit test covers `DDBWebSocket.onMessage` — the existing websocket tests cover `MessageDeduplicator`/`WebSocketManager` only. The field's live presence is confirmed in Task 9 via the module's existing raw-message console logging.)

- [ ] **Step 3: Commit**

```bash
git add scripts/websocket/DDBWebSocket.js
git commit -m "Preserve roller DDB userId on dispatched dice roll data

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: AttackRollHandler passes roll-mode options

**Files:**
- Modify: `scripts/dice/handlers/AttackRollHandler.js` (imports at line 1-2, call site ~line 70)

- [ ] **Step 1: Add the import**

Find:

```javascript
import { IRollHandler } from '../interfaces/IRollHandler.js';
import { DDBRollInjector } from '../../core/overrides/DDBRollInjector.js';
```

Replace with:

```javascript
import { IRollHandler } from '../interfaces/IRollHandler.js';
import { DDBRollInjector } from '../../core/overrides/DDBRollInjector.js';
import { RollModePolicy } from '../RollModePolicy.js';
```

- [ ] **Step 2: Pass the options at the call site**

Find:

```javascript
      // Post directly to chat (no dialog)
      const speaker = ChatMessage.getSpeaker({ actor });
      if (typeof roll.toMessage === 'function') {
        await roll.toMessage({ flavor, speaker });
      }
```

Replace with:

```javascript
      // Post directly to chat (no dialog)
      const speaker = ChatMessage.getSpeaker({ actor });
      if (typeof roll.toMessage === 'function') {
        await roll.toMessage({ flavor, speaker }, RollModePolicy.messageOptions(rollData));
      }
```

- [ ] **Step 3: Run the test suite (regression)**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/dice/handlers/AttackRollHandler.js
git commit -m "Apply roll-mode policy to synced attack rolls

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: DamageRollHandler passes roll-mode options

**Files:**
- Modify: `scripts/dice/handlers/DamageRollHandler.js` (import at line 1, call site ~line 56)

- [ ] **Step 1: Add the import**

Find:

```javascript
import { IRollHandler } from '../interfaces/IRollHandler.js';
```

Replace with:

```javascript
import { IRollHandler } from '../interfaces/IRollHandler.js';
import { RollModePolicy } from '../RollModePolicy.js';
```

- [ ] **Step 2: Pass the options at the call site**

Find:

```javascript
    const speaker = ChatMessage.getSpeaker({ actor });
    if (typeof roll.toMessage === 'function') {
      await roll.toMessage({ flavor, speaker });
    }
```

Replace with:

```javascript
    const speaker = ChatMessage.getSpeaker({ actor });
    if (typeof roll.toMessage === 'function') {
      await roll.toMessage({ flavor, speaker }, RollModePolicy.messageOptions(rollData));
    }
```

- [ ] **Step 3: Run the test suite (regression)**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/dice/handlers/DamageRollHandler.js
git commit -m "Apply roll-mode policy to synced damage rolls

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: SaveRollHandler passes roll-mode options

**Files:**
- Modify: `scripts/dice/handlers/SaveRollHandler.js` (import at line 1, call site ~line 98)

- [ ] **Step 1: Add the import**

Find:

```javascript
import { IRollHandler } from '../interfaces/IRollHandler.js';
```

Replace with:

```javascript
import { IRollHandler } from '../interfaces/IRollHandler.js';
import { RollModePolicy } from '../RollModePolicy.js';
```

- [ ] **Step 2: Pass the options at the call site**

Note this handler's `if` has no braces. Find:

```javascript
    const speaker = ChatMessage.getSpeaker({ actor });
    if (typeof roll.toMessage === 'function')
      await roll.toMessage({ flavor, speaker });
```

Replace with:

```javascript
    const speaker = ChatMessage.getSpeaker({ actor });
    if (typeof roll.toMessage === 'function')
      await roll.toMessage({ flavor, speaker }, RollModePolicy.messageOptions(rollData));
```

- [ ] **Step 3: Run the test suite (regression)**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/dice/handlers/SaveRollHandler.js
git commit -m "Apply roll-mode policy to synced saving throws

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: AbilityCheckRollHandler passes roll-mode options (two sites)

**Files:**
- Modify: `scripts/dice/handlers/AbilityCheckRollHandler.js` (import at line 1; call sites ~lines 133-135 in `handle` and ~lines 181-183 in `_handleAbilityCheck` — `rollData` is in scope in both methods)

- [ ] **Step 1: Add the import**

Find:

```javascript
import { IRollHandler } from '../interfaces/IRollHandler.js';
```

Replace with:

```javascript
import { IRollHandler } from '../interfaces/IRollHandler.js';
import { RollModePolicy } from '../RollModePolicy.js';
```

- [ ] **Step 2: Update BOTH call sites**

This exact block appears **twice** in the file (once in `handle`, once in `_handleAbilityCheck`). Replace **both** occurrences (use `replace_all` or include distinguishing surrounding lines):

```javascript
    const speaker = ChatMessage.getSpeaker({ actor });
    if (typeof roll.toMessage === 'function')
      await roll.toMessage({ flavor, speaker });
```

Replace with:

```javascript
    const speaker = ChatMessage.getSpeaker({ actor });
    if (typeof roll.toMessage === 'function')
      await roll.toMessage({ flavor, speaker }, RollModePolicy.messageOptions(rollData));
```

- [ ] **Step 3: Verify both sites changed**

Run: `grep -c "RollModePolicy.messageOptions(rollData)" scripts/dice/handlers/AbilityCheckRollHandler.js`
Expected output: `2`

- [ ] **Step 4: Run the test suite (regression)**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/dice/handlers/AbilityCheckRollHandler.js
git commit -m "Apply roll-mode policy to synced ability checks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: InitiativeRollHandler passes roll-mode options

**Files:**
- Modify: `scripts/dice/handlers/InitiativeRollHandler.js` (import at line 1, call site ~line 65)

- [ ] **Step 1: Add the import**

Find:

```javascript
import { IRollHandler } from '../interfaces/IRollHandler.js';
```

Replace with:

```javascript
import { IRollHandler } from '../interfaces/IRollHandler.js';
import { RollModePolicy } from '../RollModePolicy.js';
```

- [ ] **Step 2: Pass the options at the call site**

Find:

```javascript
    else if (initiativeBuild.isDisadvantage) { 
      flavor += ' (Disadvantage)';
    }

    await roll.toMessage({ flavor, speaker });
```

Replace with:

```javascript
    else if (initiativeBuild.isDisadvantage) { 
      flavor += ' (Disadvantage)';
    }

    await roll.toMessage({ flavor, speaker }, RollModePolicy.messageOptions(rollData));
```

(The handler also writes the result to the combat tracker via `game.combat.setInitiative` a few lines below — leave that untouched; tracker visibility follows Foundry's normal rules per the spec.)

- [ ] **Step 3: Run the test suite (regression)**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/dice/handlers/InitiativeRollHandler.js
git commit -m "Apply roll-mode policy to synced initiative rolls

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: GenericRollHandler passes roll-mode options

**Files:**
- Modify: `scripts/dice/handlers/GenericRollHandler.js` (import at line 1, call site ~line 62)

- [ ] **Step 1: Add the import**

Find:

```javascript
import { IRollHandler } from '../interfaces/IRollHandler.js';
```

Replace with:

```javascript
import { IRollHandler } from '../interfaces/IRollHandler.js';
import { RollModePolicy } from '../RollModePolicy.js';
```

- [ ] **Step 2: Pass the options at the call site**

Find:

```javascript
      else if (buildFormula.isDisadvantage) { 
        flavor += ' (Disadvantage)';
      }

      await roll.toMessage({ flavor, speaker });
```

Replace with:

```javascript
      else if (buildFormula.isDisadvantage) { 
        flavor += ' (Disadvantage)';
      }

      await roll.toMessage({ flavor, speaker }, RollModePolicy.messageOptions(rollData));
```

- [ ] **Step 3: Run the test suite (regression)**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/dice/handlers/GenericRollHandler.js
git commit -m "Apply roll-mode policy to synced generic rolls

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Final verification

- [ ] **Step 1: Confirm every call site is covered**

Run: `grep -rn "toMessage({ flavor, speaker })" scripts/`
Expected output: **empty** (every `toMessage` call now passes the policy options).

Run: `grep -rln "RollModePolicy" scripts/dice/handlers/`
Expected: all six handler files listed.

- [ ] **Step 2: Run the full suite one last time**

Run: `npx jest`
Expected: PASS, including the 10 RollModePolicy tests (9 from Task 1 plus one added in review for the both-empty-strings guard).

- [ ] **Step 3: Manual verification on the Forge (requires the user)**

Deploy the updated module to the Forge (user's usual method), then with one GM client and one player client connected:

1. GM sets the chat roll-mode dropdown to **Private GM Roll**, rolls on DDB as the GM → message appears whispered to the GM and is invisible on the player client.
2. With the GM dropdown still on Private GM Roll, the player rolls on their DDB sheet → message appears **public** on both clients (this is the latent-bug fix).
3. GM sets dropdown to **Public Roll**, rolls on DDB → message is public.
4. In the GM's browser console, confirm the raw `DDB Sync | Message received:` log for a roll shows a top-level `userId` field (validates the envelope assumption from the spec).

If check 4 ever shows no `userId`, rolls fall back to public with a console warning — the failure mode is today's behavior, never a hidden player roll.
