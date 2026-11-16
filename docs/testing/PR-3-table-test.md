# PR #3 — testplan ved bordet og lokal review

PR: <https://github.com/whelan/ddb-sync/pull/3> · branch `claude/peaceful-feynman-xd9qr0` · modulversion **0.0.16**

PR'en samler syv ændringer:

| Commit | Hvad |
|---|---|
| `2b4e6d6` | Slot-besked: "X casts a spell (spent level N spell slot on D&D Beyond)" |
| `274ef8a` `fe5824a` | Spell-kort i chatten når en spell rulles på D&D Beyond + "Place template"-knap |
| `6ead20b` `ea88380` | Kun Foundry v14 + dnd5e 6: Regions i stedet for MeasuredTemplates, `messageMode` i stedet for `rollMode`, DialogV2, ingen jQuery |
| `8726591` | Monk's TokenBar "Request Roll" besvares med rul fra D&D Beyond (saves, ability og skill checks) |
| `b915b2c` | Monk's TokenBar: death saves og initiative |

Jest (`npm test`) er grøn: 21 suites, 328 tests. **Intet er kørt i en rigtig Foundry-verden endnu.** Den del er denne fil.

---

## Del 1 — Testen der skal udføres

> **Kørt 2026-11-16** i Forge-verdenen (Foundry 14.370, dnd5e 6.0.6, TokenBar 14) med Varis (Andreas) og Pyrax. To fejl fundet og rettet undervejs: 0.0.17 (death save/TokenBar-rul hang i dice mode D&D Beyond) og 0.0.18 (ét kort og én whisper pr. kast over et 60 s glidende vindue). Ikke dækket: C2–C8 (ingen area-spell med rul på holdet), D6 og D10.

### Forberedelse

1. Foundry **v14**, dnd5e **6.x**, Monk's TokenBar **14.x** (valgfrit: Dice So Nice).
2. Installer modulet fra branchen (`git checkout claude/peaceful-feynman-xd9qr0` i `Data/modules/ddb-sync`), genstart verdenen.
3. Åbn browserkonsollen (F12) og slå **Debug Logging** til i modulets indstillinger. Alle linjer starter med `DDB Sync |`.
4. Én testkarakter, koblet til D&D Beyond (Character Mapping), ejet af en spillerkonto. Den skal have:
   - en spell med angrebs- eller save-rul **og** et area of effect (fx *Fireball* eller *Burning Hands*),
   - en spell uden rul (fx *Shield* eller *Bless*),
   - ledige spell slots.
5. En spillerklient logget ind som ejeren (anden browser eller privat vindue), så både GM- og spillervisning kan tjekkes.
6. En scene med karakterens token, og en kamp (combat) med tokenet tilføjet men **ikke startet** endnu.

Skriv resultat i kolonnen ✓/✗ og noter konsol-fejl ved hvert ✗.

### A. Grundlæggende sync (regression efter v14-migreringen)

| # | Gør | Forventet | ✓/✗ |
|---|---|---|---|
| A1 | Indstil GM's roll mode til **Private GM Roll**. Spilleren slår et ability check på D&D Beyond. | Rullet kommer i chatten **offentligt** (spillerejet actor). | ✓ |
| A2 | Spilleren slår angreb + skade med et våben på D&D Beyond. | To rul i chatten med D&D Beyonds terningværdier og Foundrys modifier. | ✓ |
| A3 | Spilleren ændrer HP på D&D Beyond. | HP opdateres på actoren. | ✓ |
| A4 | Spilleren sætter *Poisoned* på D&D Beyond, fjerner den igen. | Condition sættes og fjernes på tokenet. | ✓ |
| A5 | Spilleren slår en death save på D&D Beyond (uden TokenBar). | dnd5e's death save-kort; success/failure tælles på actoren. | ✓ (0.0.17: hang i dice mode D&D Beyond rettet) |
| A6 | Spilleren slår initiative på D&D Beyond, mens kampen er startet. | Rul i chatten, og initiative sat i combat trackeren. | ✓ |
| A7 | Åbn karakterens sheet. | Rullemenuen (Normal / Manual / D&D Beyond) vises og kan ændres. | ✓ |
| A8 | Sæt menuen til **Manual**, klik et ability check på sheetet. | Vindue til at taste terningværdier; resultatet bruges. Sæt tilbage til Normal. | — sprunget over (Manual bruges ikke) |
| A9 | Sæt menuen til **D&D Beyond**, klik et save på sheetet, slå samme save på D&D Beyond. | Foundry venter og bruger D&D Beyonds terninger. Sæt tilbage til Normal. | — TokenBar overtager sheet-klik, se D1–D2 |
| A10 | Sæt en ugyldig CobaltSession-cookie og genforbind. | Dialogen "D&D Beyond Cookie Expired" åbner (DialogV2), knappen åbner indstillinger. Sæt gyldig cookie igen. | — sprunget over |
| A11 | Åbn Game Settings-fanen som GM. | Knappen til Character Mapping findes. | — |

### B. Spell slot-besked

| # | Gør | Forventet | ✓/✗ |
|---|---|---|---|
| B1 | Genindlæs Foundry. Spilleren kaster *Shield* (uden rul) på D&D Beyond. | **Ingen** besked første gang (første opdatering er kun udgangspunkt). | ✓ |
| B2 | Kast *Shield* igen. | Chat: "<navn> casts a spell (spent level 1 spell slot on D&D Beyond)". | ✓ |
| B3 | Warlock (hvis muligt): brug en pact slot. | "…level N pact magic slot…". | — ingen warlock-slot på testkarakteren |
| B4 | Tag long rest på D&D Beyond. | Ingen besked. | — sprunget over |
| B5 | Slå **Spell Announcements to GM Only** til, kast igen. | Beskeden er en whisper til GM. Slå fra igen. | ✓ |

### C. Spell-kort og templates (Regions)

| # | Gør | Forventet | ✓/✗ |
|---|---|---|---|
| C1 | Kast *Fireball* på D&D Beyond (save + skade). | **Ét** dnd5e spell-kort i chatten over rullene, offentligt. Ingen ekstra slot-besked (inden for 15 s). | ✓ (0.0.18: to kort ved 31 s mellem angreb og skade rettet) |
| C2 | Se kortet som GM og som spiller. | Knappen **Place template** vises for begge. En tredje spiller uden ejerskab ser den ikke. | — ingen area-spell med rul på holdet |
| C3 | Spilleren klikker Place template og placerer. | En **Region** oprettes med dnd5e's egen placering (samme form og størrelse som fra sheetet). | — |
| C4 | Med **Remove Spell Templates in Combat = At the next round**: start kampen, placer, skift tur, skift runde. | Regionen står efter tur-skift og fjernes ved ny runde. | — |
| C5 | Indstil **At the next turn**, placer, skift tur. | Regionen fjernes ved tur-skift. | — |
| C6 | Placer uden for kamp. | Regionen bliver stående. | — |
| C7 | Placer i kamp, slet kampen. | Regionen fjernes (medmindre indstillingen er Never). | — |
| C8 | Kast en spell, karakteren **ikke** har i Foundry. | Intet kort, rullene kommer som normalt. | — |
| C9 | Slå **postSpellCards** fra, kast *Fireball*. | Intet kort. Slå til igen. | ✓ |

### D. Monk's TokenBar

Kampen skal være startet for D5.

| # | Gør | Forventet | ✓/✗ |
|---|---|---|---|
| D1 | TokenBar → Request Roll: Wisdom save, DC 15, for testkarakteren. | Spilleren (og GM) får whisper: "Roll Wisdom Saving Throw on D&D Beyond (<navn>)". | ✓ |
| D2 | Spilleren slår Wisdom save på D&D Beyond. | Resultatet står i TokenBar-kortet med pass/fail mod DC 15. **Ingen** separat chatbesked. | ✓ |
| D3 | Request Roll: Perception (skill) og bagefter Strength (ability check). Slå dem på D&D Beyond. | Begge lander i deres kort. | ✓ |
| D4 | Request Roll: Death Saving Throw. Slå death save på D&D Beyond. | Resultat i kortet; actorens death save success/failure tæller op; intet ekstra dnd5e-kort. | ✓ |
| D5 | Request Roll: Initiative. Slå initiative på D&D Beyond. | Resultat i kortet **og** i combat trackeren. | — TokenBar tilbyder ikke Initiative i Request Roll |
| D6 | Request Roll for to tokens; den ene slår med kortets egen knap i Foundry, den anden på D&D Beyond. | Begge resultater står; ingen overskrives. | — |
| D7 | Slå et save på D&D Beyond, som **ikke** er anmodet. | Rullet kommer i chatten som normalt. | ✓ |
| D8 | Request Roll med **advantage** på D&D Beyond. | Kortets total matcher D&D Beyonds (højeste terning). | ✓ |
| D9 | Lav en anmodning, genindlæs GM-klienten, slå rullet på D&D Beyond. | Rullet lander stadig i kortet; ingen ny whisper ved genindlæsning. | ✓ |
| D10 | Med Dice So Nice: gentag D2. | Terningerne vises højst én gang. | — |
| D11 | Slå **monksTokenBarRequests** fra, gentag D1–D2. | Ingen whisper; rullet kommer som almindelig chatbesked. | ✓ |

### E. Barovia spell flavor

Journalen **Barovia Spell Flavor** skal være pushet til verdenen (GM-only). Testkarakteren skal ejes af en spiller.

| # | Gør | Forventet | ✓/✗ |
|---|---|---|---|
| E1 | Spilleren slår en spell med entry (fx *Healing Word*) på D&D Beyond. | GM får **én** whisper "Healing Word · <navn>" med den danske read-aloud. Spilleren ser intet. | ✓ |
| E2 | Spilleren kaster samme spell fra Foundry-sheetet. | GM får én whisper. Ingen dobbelt whisper, heller ikke når kast fra D&D Beyond og sheet sker inden for 60 sek. af hinanden. | ✓ |
| E3 | Kast en spell uden entry i journalen. | Whisper med skolens standardtekst (fx Evocation). | ✓ |
| E4 | Kast en karakter-spell, som **ikke** er afkrydset i Reveal log. | Whisperen har linjen "First use — narrate it and tick the Reveal log". | ✓ |
| E5 | Omdøb journalen midlertidigt og kast en spell. | Ingen whisper, ingen fejl i konsollen; rul og kort virker som normalt. Navngiv journalen tilbage. | ✓ |

### Kendte risici (tjek særligt)

- **TokenBar-internt API**: broen importerer `modules/monks-tokenbar/apps/savingthrow.js` og kalder `SavingThrow.updateMessage`. Lander D2 ikke i kortet, er det her. Kan knække ved TokenBar-opdateringer.
- **Plain `Roll` i TokenBar-kortet**: kritisk-markering (nat 20/1) kan se anderledes ud end ved TokenBars egne rul.
- **dnd5e `rollDeathSave(..., { create: false })`**: opdaterer success/failure uden kort (læst i dnd5e 6.1-koden, ikke kørt).
- **Region-ejerskab**: spilleren opretter Regionen selv, ligesom ved cast fra sheetet. Hvis spillere ikke må lave Regions i jeres verden, fejler C3 for spilleren.
- **`renderDocumentSheetV2`** skal fyre for dnd5e 6-sheetet (A7), og **`#settings-game`** skal findes i v14 (A11).
- **`ChatMessage.create` + `messageMode`**: fallback-spellkortet bruger `ChatMessage.applyMode`; kun relevant hvis dnd5e's `displayCard` fejler.

---

## Del 2 — Plan til lokal review

1. Tjek branchen ud lokalt og kør `npm install && npm test`.
2. Lad Claude Code læse PR'en og koden igennem med prompten nedenfor (kodereview mod dnd5e 6 / Foundry v14 / TokenBar 14).
3. Kør testen i Del 1 ved bordet (eller i en testverden) og udfyld ✓/✗.
4. Giv Claude de udfyldte tabeller og konsol-fejl; den retter og pusher til samme branch.
5. Når alt er ✓: sæt `verified` i `module.json`, merge PR #3.

### Prompt (kopier til Claude Code lokalt, i ddb-sync-repoet)

```text
Kig på PR #3 i whelan/ddb-sync (branch claude/peaceful-feynman-xd9qr0). Læs
docs/testing/PR-3-table-test.md først: den beskriver hvad PR'en gør, testen
der skal udføres og de kendte risici.

1. git fetch && git checkout claude/peaceful-feynman-xd9qr0 && npm install && npm test.
   Rapportér antal suites/tests og eventuelle fejl.

2. Review koden mod de rigtige API'er, ikke fra hukommelsen:
   - dnd5e 6.x kilde (klon github.com/foundryvtt/dnd5e, tag 6.x der matcher min
     installation): item.displayCard, TemplatePlacement.fromActivity,
     actor.rollDeathSave(config, dialog, message) med create:false,
     BasicRoll.toMessage, D20Roll/DamageRoll.evaluate (DDBRollInjector).
   - Foundry v14 API (foundryvtt.com/api/v14): Roll#toMessage messageMode,
     ChatMessage.applyMode, DialogV2, renderChatMessageHTML,
     renderDocumentSheetV2, renderSettings, game.users.activeGM, Regions.
   - Monk's TokenBar 14.x kilde (github.com/ironmonk88/monks-tokenbar):
     apps/savingthrow.js updateMessage/returnRoll, flags på request-kortet,
     systems/dnd5e-rolls.js misc-requests 'death' og 'init'.
   Fokusér på filerne: scripts/core/services/SpellCardService.js,
   SpellTemplateService.js, SpellSlotNotifier.js,
   scripts/integrations/MonksTokenBarBridge.js, scripts/dice/RollModePolicy.js,
   scripts/dice/DDBRollKeys.js, scripts/core/handlers/DiceRollMessageHandler.js,
   scripts/main.js, scripts/core/DDBSyncManager.js.

3. Hvis min Foundry kører og du har adgang (fx via foundry-mcp-bridge):
   kør de dele af testen i Del 1 du kan udføre uden en rigtig D&D Beyond-
   spiller, fx ved at fodre DiceRollMessageHandler med optagne
   dice/roll/fulfilled-payloads. Ellers: giv mig en kort liste over hvilke
   tests jeg selv skal køre først (højeste risiko først).

4. Skriv fund som: fil:linje, hvad der er galt, konkret scenarie, forslag.
   Ret kun rigtige fejl, kør npm test, commit på samme branch og push.
   Rør ikke ved tests for at få grønt.

Når jeg giver dig de udfyldte ✓/✗-tabeller fra testen, så ret ✗'erne én
for én og opdatér tabellen i docs/testing/PR-3-table-test.md.
```
