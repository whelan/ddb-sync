import { IRollHandler } from '../../dice/interfaces/IRollHandler.js';

/**
 * Generic Roll Handler
 * Last-resort fallback for any roll type not handled by a specific handler.
 * MUST be registered last in DDBSyncManager.registerRollHandlers().
 *
 * This handler intentionally does the minimum: build a plain roll and post it.
 * It does NOT attempt to link to usage cards or build typed rolls — those
 * concerns belong to AttackRollHandler and DamageRollHandler.
 *
 * If you find a roll type landing here that should have richer behaviour,
 * create a dedicated handler for it and register it before this one.
 */
export class GenericRollHandler extends IRollHandler {
  constructor(diceExtractor, rollBuilder) {
    super();
    this.diceExtractor = diceExtractor;
    this.rollBuilder   = rollBuilder;
    this.logger        = console;
  }

  // Catches everything — must be last in the handler list
  canHandle(rollData) { return true; }
  usesCache()         { return false; }

  async handle(actor, rollData) {
    const rollType   = rollData.rollType || rollData.rolls?.[0]?.rollType || 'generic';
    const actionName = rollData.action ?? 'Unknown';

    this.logger.log(
      `DDB Sync | GenericRollHandler: handling "${actionName}" (${rollType}) for ${actor.name}`
    );

    const ddbDiceResults = this.diceExtractor.extractDiceResults(rollData);
    const parsed         = this.diceExtractor.parseDiceFormula(rollData);

    // buildRoll() produces a plain Roll — appropriate for anything that doesn't
    // need typed dice (D20Roll / DamageRoll) or chat card linking.
    const roll = await this.rollBuilder.buildRoll(parsed.formula, ddbDiceResults);

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor:  `${actionName}`,
      flags: {
        dnd5e: {
          messageType: 'roll',
        },
        core: { canPopout: true },
      },
    });

    this.logger.log(
      `DDB Sync | GenericRollHandler: posted roll for "${actionName}" total=${roll.total}`
    );
  }
}
