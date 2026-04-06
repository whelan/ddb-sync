import { IRollHandler } from '../../dice/interfaces/IRollHandler.js';

/**
 * Attack Roll Handler
 * Handles "to hit" rolls from DDB and produces two Foundry chat messages:
 *   1. A usage card  (mirrors socket 42218 / messageType:"usage")
 *   2. An attack roll (mirrors socket 42219 / messageType:"roll", roll.type:"attack")
 *
 * The usage card _id is stored on game.DDBSync.lastUsage keyed by actor.id so that
 * DamageRollHandler can link the subsequent damage roll to the same card via
 * originatingMessage — which is what makes the Damage button and Effects section
 * appear correctly in the Foundry chat UI.
 */
export class AttackRollHandler extends IRollHandler {
  constructor(diceExtractor, rollBuilder) {
    super();
    this.diceExtractor = diceExtractor;
    this.rollBuilder   = rollBuilder;
    this.logger        = console;
  }

  canHandle(rollData) {
    const rollType = rollData.rollType || rollData.rolls?.[0]?.rollType || '';
    return rollType.toLowerCase() === 'to hit';
  }

  usesCache() { return true; }

  async handle(actor, rollData) {
    const actionName = rollData.action;

    // ── Resolve item ────────────────────────────────────────────────────────
    const item = actor.items.find(
      i => i.name.toLowerCase() === actionName?.toLowerCase()
    );
    if (!item) {
      this.logger.warn(`DDB Sync | AttackRollHandler: no item "${actionName}" on ${actor.name}`);
      return;
    }

    // ── Resolve live Activity instance ──────────────────────────────────────
    // item.system.activities is a DataCollection in dnd5e 5.x.
    // .values() yields fully-instantiated Activity class objects with all their
    // methods. Using .find() directly on the collection or reading .contents
    // gives plain data snapshots that are missing those methods.
    const activity = [...(item.system.activities?.values() ?? [])].find(
      a => a.type === 'attack'
    );
    if (!activity) {
      this.logger.warn(`DDB Sync | AttackRollHandler: no attack activity on "${item.name}"`);
      return;
    }

    // ── STEP 1: Usage card (replicates socket 42218) ────────────────────────
    // We build the card content by rendering the dnd5e HBS template directly
    // rather than calling any Activity methods (which may not exist or may
    // trigger unwanted side-effects like spell slot consumption dialogs).
    const usageCard = await this._createUsageCard(actor, item, activity);
    if (!usageCard) return;

    const usageId = usageCard.id;

    // ── STEP 2: Build the D20Roll from DDB data ──────────────────────────────
    const ddbDiceResults = this.diceExtractor.extractDiceResults(rollData);
    const parsed         = this.diceExtractor.parseDiceFormula(rollData);
    const roll           = await this.rollBuilder.buildAttackRoll(
      parsed.formula,
      ddbDiceResults,
      parsed
    );

    // ── STEP 3: Attack roll message (replicates socket 42219) ───────────────
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor:  `${item.name} - Attack Roll`,
      sound:   'sounds/dice.wav',
      flags: {
        dnd5e: {
          activity:           { id: activity.id, uuid: activity.uuid },
          item:               { id: item.id,      uuid: item.uuid      },
          targets:            Array.from(game.user.targets).map(t => ({ uuid: t.document.uuid })),
          messageType:        'roll',
          roll:               { type: 'attack' },
          originatingMessage: usageId,
        },
        core: { canPopout: true },
      },
    });

    // ── STEP 4: Store usageId for DamageRollHandler ─────────────────────────
    // Keyed by actor.id — one active usage per actor at a time, which is
    // correct since a player can only be resolving one attack sequence at once.
    if (!game.DDBSync.lastUsage) game.DDBSync.lastUsage = new Map();
    game.DDBSync.lastUsage.set(actor.id, usageId);

    this.logger.log(
      `DDB Sync | AttackRollHandler: usage card ${usageId}, attack roll done for ${actor.name}`
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Render and create the usage card ChatMessage.
   * Matches the flags and content structure from socket 42218.
   */
  async _createUsageCard(actor, item, activity) {
    let content;
    try {
      content = await this._renderActivityCard(actor, item, activity);
    } catch (err) {
      this.logger.error('DDB Sync | AttackRollHandler: failed to render activity card', err);
      return null;
    }

    // ActiveEffect IDs on the item (e.g. the Ray of Frost speed reduction effect).
    const effectIds = item.effects?.map(e => e.id) ?? [];

    return ChatMessage.create({
      user:    game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      flags: {
        dnd5e: {
          activity:    { type: activity.type, id: activity.id, uuid: activity.uuid },
          item:        { type: item.type,     id: item.id,     uuid: item.uuid     },
          targets:     [],
          messageType: 'usage',
          use:         { effects: effectIds },
        },
        core: { canPopout: true },
      },
    });
  }

  /**
   * Render the activity-card.hbs template with only the data keys needed for
   * static display — we never call Activity methods here so there's nothing to crash.
   */
  async _renderActivityCard(actor, item, activity) {
    const subtitle = item.system.school
      ? (CONFIG.DND5E?.spellSchools?.[item.system.school]?.label ?? item.system.school)
      : (game.i18n.localize(`TYPES.Item.${item.type}`) ?? item.type);

    const pills = this._buildFooterPills(item);

    const description = item.system.description?.value ?? '';

    const hasAttack = [...(item.system.activities?.values() ?? [])].some(a => a.type === 'attack');
    const hasDamage = hasAttack &&
      !!(item.system.damage?.base?.formula || item.system.damage?.parts?.length);

    return renderTemplate('systems/dnd5e/templates/chat/activity-card.hbs', {
      actor,
      item,
      activity,
      subtitle,
      description,
      pills,
      hasAttack,
      hasDamage,
      isEmbedded: true,
    });
  }

  /**
   * Build footer pill data from item system data.
   * These are the small tags at the bottom of the chat card (V, S, Action, 60 ft, etc.)
   * mirroring what the socket trace showed.
   */
  _buildFooterPills(item) {
    const pills = [];
    const sys   = item.system;

    // Spell components (V, S, M, C, R)
    if (sys.properties) {
      const componentMap = { vocal: 'V', somatic: 'S', material: 'M', concentration: 'C', ritual: 'R' };
      const parts = Object.entries(componentMap)
        .filter(([key]) => sys.properties.has?.(key) ?? sys.properties[key])
        .map(([, label]) => label);
      if (parts.length) pills.push({ label: parts.join(', ') });
    }

    // Activation type (Action, Bonus Action, Reaction, etc.)
    const activation = sys.activation?.type;
    if (activation) {
      const label = CONFIG.DND5E?.activityActivationTypes?.[activation]?.label ?? activation;
      pills.push({ label });
    }

    // Duration
    const durValue = sys.duration?.value;
    const durUnit  = sys.duration?.units;
    if (durValue && durUnit && durUnit !== 'inst') {
      const unitLabel = CONFIG.DND5E?.timePeriods?.[durUnit]?.label ?? durUnit;
      pills.push({ label: `${durValue} ${unitLabel}` });
    } else if (durUnit === 'inst') {
      pills.push({ label: 'Instantaneous' });
    }

    // Range
    const rangeVal  = sys.range?.value;
    const rangeUnit = sys.range?.units;
    if (rangeVal && rangeUnit && !['touch', 'self'].includes(rangeUnit)) {
      const unitLabel = CONFIG.DND5E?.movementUnits?.[rangeUnit] ?? rangeUnit;
      pills.push({ label: `${rangeVal} ${unitLabel}` });
    } else if (rangeUnit === 'touch') {
      pills.push({ label: 'Touch' });
    } else if (rangeUnit === 'self') {
      pills.push({ label: 'Self' });
    }

    // Target
    const targetVal  = sys.target?.affects?.count ?? sys.target?.value;
    const targetType = sys.target?.affects?.type  ?? sys.target?.type;
    if (targetVal && targetType) {
      const typeLabel = CONFIG.DND5E?.individualTargetTypes?.[targetType]?.label ?? targetType;
      pills.push({ label: `${targetVal} ${typeLabel}` });
    } else if (targetType) {
      const typeLabel = CONFIG.DND5E?.individualTargetTypes?.[targetType]?.label ?? targetType;
      pills.push({ label: typeLabel });
    }

    return pills;
  }
}
