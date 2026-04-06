/* scripts/core/services/MediatedActionService.js */

export class MediatedActionService {
    // Map of actorId -> { rollData, item, usageMessageId, targetUuid }
    static session = new Map();

    /**
     * Create a whisper to the GM to confirm an incoming DDB action
     */
    static async createPrompt(actor, rollData, item) {
        const ddbTotal = rollData.rolls?.[0]?.result?.total || rollData.result?.total || "??";
        
        const content = `
            <div class="ddb-mediated-prompt" data-actor-id="${actor.id}" data-item-id="${item.id}">
                <header style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <img src="${item.img}" width="32" height="32" style="border:none"/>
                    <strong>DDB: ${item.name}</strong>
                </header>
                <p>${actor.name} rolled a <strong>${ddbTotal}</strong> to hit.</p>
                <button type="button" class="ddb-confirm-btn" style="background:rgba(0,0,0,0.1); border:1px solid #555; cursor:pointer;">
                    <i class="fas fa-crosshairs"></i> Assign to Target
                </button>
            </div>
        `;

        return await ChatMessage.create({
            user: game.user.id,
            speaker: { alias: "DDB Sync Bridge" },
            content: content,
            whisper: [game.user.id],
            flags: { "ddb-sync": { isPrompt: true, actorId: actor.id, itemId: item.id } }
        });
    }

    /**
     * The actual "Blessing" logic that executes the Foundry cards
     */
    static async confirmAction(actorId, itemId, promptMessage) {
        const state = this.session.get(actorId);
        if (!state) return console.error("DDB Sync | No session found for confirmation");

        const actor = game.actors.get(actorId);
        const item = actor.items.get(itemId);
        const target = game.user.targets.first();

        // 1. Create native Usage Card (v4 style)
        const activity = item.system.activities.find(a => a.type === "attack") || item.system.activities.contents[0];
        const usageCard = await activity.createUsageMessage({ chatMessage: true });

        // 2. Build the Roll Card using your socket payload structure
        const ddbRoll = state.rollData.rolls?.[0]?.result || state.rollData.result;
        const roll = new Roll(ddbRoll.text);
        roll._total = ddbRoll.total;
        roll._evaluated = true;

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flags: {
                "dnd5e": {
                    "item": { "id": item.id, "uuid": item.uuid },
                    "activity": { "id": activity.id, "uuid": activity.uuid },
                    "messageType": "roll",
                    "roll": { "type": "attack" },
                    "originatingMessage": usageCard.id,
                    "targets": target ? [{ uuid: target.document.uuid }] : []
                }
            }
        });

        // 3. Update session so GenericRollHandler can find the message ID for damage
        state.usageMessageId = usageCard.id;
        
        // 4. Delete the prompt card
        await promptMessage.delete();
    }
}
