import { IRollHandler } from '../interfaces/IRollHandler.js';

/**
 * Damage Roll Handler
 * Handles "damage" rolls from DDB and produces a Foundry DamageRoll chat message
 * that mirrors socket 42223 exactly:
 *   - messageType: "roll", roll.type: "damage"
 *   - originatingMessage points to the usage card created by AttackRollHandler
 *   - Uses dnd5e.dice.DamageRoll with the correct type/types/properties options
 *     so the chat card renders with the damage type pill and critical hit styling
 *
 * This handler MUST be registered before GenericRollHandler in DDBSyncManager
 * so it intercepts damage rolls before the fallback catches them.
 */
export class DamageRollHandler extends IRollHandler {
  constructor(diceExtractor, rollBuilder) {
    super();
    this.diceExtractor = diceExtractor;
    this.rollBuilder   = rollBuilder;
    this.logger        = console;
  }

  canHandle(rollData) {
    const rollType = rollData.rollType || rollData.rolls?.[0]?.rollType || '';
    return rollType.toLowerCase() === 'damage';
  }

  usesCache() { return false; }

  async handle(actor, rollData) {
    const actionName = rollData.action;

    // ── Resolve item ────────────────────────────────────────────────────────
    const item = actor.items.find(
      i => i.name.toLowerCase() === actionName?.toLowerCase()
    );
    if (!item) {
      this.logger.warn(`DDB Sync | DamageRollHandler: no item "${actionName}" on ${actor.name}`);
      return;
    }

    // ── Resolve live Activity instance ──────────────────────────────────────
    // Same pattern as AttackRollHandler — .values() for live instances.
    const activity = [...(item.system.activities?.values() ?? [])].find(
      a => a.type === 'attack'
    );

    // ── Retrieve usageId set by AttackRollHandler ────────────────────────────
    // This is what links this damage roll back to the usage card so the
    // "Apply Damage" button knows which card it belongs to.
    const usageId = game.DDBSync?.lastUsage?.get(actor.id) ?? null;
    if (!usageId) {
      this.logger.warn(
        `DDB Sync | DamageRollHandler: no cached usageId for ${actor.name} — ` +
        `damage roll will not be linked to a usage card`
      );
    }

    // ── Determine damage type ────────────────────────────────────────────────
    // Prefer the item's defined damage type, fall back to heuristic from action name.
    const damageType = this._resolveDamageType(item, rollData);

    // ── Determine item properties (e.g. "mgc" for spells) ───────────────────
    // dnd5e uses these to determine damage resistance/immunity interactions.
    const properties = this._resolveItemProperties(item);

    // ── Build DamageRoll from DDB data ───────────────────────────────────────
    const ddbDiceResults = this.diceExtractor.extractDiceResults(rollData);
    const parsed         = this.diceExtractor.parseDiceFormula(rollData);
    const roll           = await this.rollBuilder.buildDamageRoll(
      parsed.formula,
      ddbDiceResults,
      { damageType, properties }
    );

    // ── Build flags ──────────────────────────────────────────────────────────
    // Mirror socket 42223 exactly. activity/item flags are present only if we
    // resolved an activity; targets comes from current user selection.
    const dnd5eFlags = {
      targets:            Array.from(game.user.targets).map(t => ({ uuid: t.document.uuid })),
      messageType:        'roll',
      roll:               { type: 'damage' },
      originatingMessage: usageId,
    };

    if (activity) {
      dnd5eFlags.activity = { id: activity.id, uuid: activity.uuid };
      dnd5eFlags.item     = { id: item.id,      uuid: item.uuid      };
    }

    // ── Post damage roll message (replicates socket 42223) ──────────────────
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor:  `${item.name} - Damage Roll`,
      sound:   'sounds/dice.wav',
      flags: {
        dnd5e: dnd5eFlags,
        core: { canPopout: true },
      },
    });

    this.logger.log(
      `DDB Sync | DamageRollHandler: ${damageType} damage roll done for ${actor.name}, ` +
      `linked to usage card ${usageId}`
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Resolve the primary damage type string for this item.
   *
   * dnd5e 5.x stores damage on item.system.damage.base (the primary damage part)
   * as a DataModel with a .types Set.  We prefer that; if it's absent we fall
   * back to scanning the roll action name and rollKind for a known damage type
   * keyword (same heuristic GenericRollHandler used, but done properly).
   */
  _resolveDamageType(item, rollData) {
    // dnd5e 5.x — activity-based damage
    const baseDamage = item.system.damage?.base;
    if (baseDamage?.types?.size) {
      return [...baseDamage.types][0];
    }

    // Older schema — damage.parts array where each part is [formula, type]
    const parts = item.system.damage?.parts;
    if (Array.isArray(parts) && parts[0]?.[1]) {
      return parts[0][1];
    }

    // Heuristic fallback: scan the action name and rollKind
    const haystack = (
      (rollData.action ?? '') + ' ' + (rollData.rolls?.[0]?.rollKind ?? '')
    ).toLowerCase();

    const knownTypes = [
      'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
      'necrotic', 'piercing', 'poison', 'psychic', 'radiant',
      'slashing', 'thunder',
    ];
    return knownTypes.find(t => haystack.includes(t)) ?? '';
  }

  /**
   * Resolve the item's property tags as an array of dnd5e property keys.
   * Spells are "mgc" (magical) by default; weapons may have additional tags.
   * The "mgc" flag is what Foundry checks when applying damage vs magical
   * resistance on monsters.
   */
  _resolveItemProperties(item) {
    // item.system.properties can be a Set (dnd5e 5.x) or a plain object
    const props = item.system.properties;
    if (props instanceof Set) {
      return [...props].filter(p => CONFIG.DND5E?.itemProperties?.[p]);
    }
    if (props && typeof props === 'object') {
      return Object.keys(props).filter(
        p => props[p] && CONFIG.DND5E?.itemProperties?.[p]
      );
    }

    // Spells are always magical even if properties is empty
    if (item.type === 'spell') return ['mgc'];
    return [];
  }
}
