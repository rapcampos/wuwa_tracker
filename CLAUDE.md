# CLAUDE.md — Wuthering Waves Resource Planner ("Resonance Ledger")

## What this is

A personal, single-user resource planner for Wuthering Waves, in the spirit of
genshin-center.com/planner. The user keeps an ordered priority queue of build
goals (characters now, weapons planned); the app computes materials per goal,
aggregate totals, inventory-aware deficits, and a "farm next" allocation.

**The entire app is one self-contained file: `wuwa-planner.html`.**
No build step, no dependencies, no backend. The user double-clicks it locally.
Do not split it into multiple files, add a bundler, or introduce frameworks —
"open the file, edit one block, refresh" is the maintenance model the user chose.

## File layout (three `<script>` blocks, strict layering)

1. **Block 1 — `GAME` data + ordinal helpers.** Hand-curated game data. Cost
   templates, EXP curves, material families, character entries, icon config.
   Heavily commented so the user can add patch characters themselves.
2. **Block 2 — engine.** Pure functions only. **No DOM access anywhere** —
   this is what makes it testable in Node by eval'ing the blocks straight out
   of the HTML. Key exports: `costForGoal`, `totalBag`, `remainingBag`,
   `expToPotions`, `farmNextWalk`, `buildMatRegistry`/`MATS`, `sortMatIds`.
3. **Block 3 — UI layer.** State, persistence, rendering, event wiring.
   All DOM code lives here and nowhere else.

Preserve this layering in every change. If a new feature needs calculation,
it goes in block 2 with tests; presentation goes in block 3.

## Core model

- **Level states are ordinals 0–13:** Lv1, 20, 20✦, 40, 40✦, 50, 50✦, 60, 60✦,
  70, 70✦, 80, 80✦, 90 (✦ = ascended). Ascension rank r sits at ordinal `2r`.
  "Ranks crossed" between two states is a clean integer comparison — this
  encoding exists to kill off-by-one bugs; don't replace it with raw levels.
- **Bags** are plain `{materialId: qty}` objects. Special ids: `credits`
  (Shell Credits), `exp` (raw Resonator EXP), and `wexp` (raw Weapon EXP —
  a fully separate pool: potions never feed `wexp`, energy cores never feed
  `exp`). Family materials are `<familyId><tierIndex 0-3>` (e.g. `howler2`);
  named mats are prefixed `boss:`, `spec:`, `wk:` + display name — the `wk:`
  keying is what makes a shared weekly (Sentinel's Dagger: Jinhsi + Phoebe)
  merge in totals.
- **Weapon goals** are `{weapon: id, cur: {ord}, tgt: {ord}}` — the `weapon`
  key is the discriminator vs `char` goals (old saves only ever have `char`),
  and the state is level ordinal only: no forte tree, no boss/spec/weekly
  mats. `costForGoal` dispatches on it; rarity (5/4★) picks the template
  (`asc5w`/`asc4w`, `wpnExpCum5`/`wpnExpCum4`). Unlike characters, duplicate
  weapon goals are allowed (players level multiple copies) — sanitize and
  the add-menu deliberately don't dedupe them.
- **Cost templates are shared by ALL characters** — 4★ and 5★ cost identical
  amounts (datamine-verified across the full roster); a character entry only
  names *which* materials it uses (boss, specialty, weekly, common family,
  forge family). Adding a new character is one small entry in
  `GAME.characters` — never duplicate cost tables. The only exceptions are
  Rover forms, handled by two optional entry fields: `bossCounts` (per-rank
  boss qty — Mysterious Code ×1 at ranks 2-6 instead of the 46-total curve)
  and `ascCommon` (Rover: Aero ascends with whisperin but fortes with tidal).
  The full roster through 3.5 is seeded (~50 entries incl. 3 Rover forms).
- **Forte node tree:** `goal.nodes` is a 2×5 tri-state matrix,
  `nodes[row][col]`, row 0 = lower tier, row 1 = upper, column 2 = Inherent
  Ⅰ/Ⅱ, stat columns are 0,1,3,4. Values: 0 skip, 1 planned, 2 owned.
  **In-game rule (user-confirmed): an upper node requires its lower node,
  and Inherent Ⅱ requires Ⅰ.** Invariant: `nodes[0][c] ≥ nodes[1][c]` for all
  columns; `enforceTree()` repairs violations by raising the lower cell, and
  click handlers cascade (raise top → pull bottom up; lower bottom → pull top
  down). The matrix is the source of truth; count fields on `cur`/`tgt`
  (`minor`, `major`, `inh1`, `inh2`) are *derived* via `syncNodeCounts()` for
  the engine, which only ever consumes counts.
- **Default goal targets** are per-rarity templates in `state.defaults[4|5]`
  (a tgt-shaped state: ord/skills/inh/minor/major). New character goals start
  from them (`newGoal` takes the map as a parameter — it runs before `state`
  exists at boot). Built-ins in `defaultGoalTgt(r)` (engine): 5★ Lv90 ·
  forte 6 · all nodes; 4★ Lv80 · forte 6 · all nodes. The edit pop-up has
  "⤒ Max target" (Lv90 / skills 10 / every node & passive at least planned)
  and "✓ Max goal" (current → target — planned nodes flip to owned, skipped
  stay skipped; the goal then costs nothing and its card offers ✓ Mark
  completed). Weapons: both buttons, level-only. Defaults are edited from
  the toolbar ("Templates" → the same
  pop-up in template mode via `editTpl`, with a 4★/5★ switch and a reset
  button; template nodes toggle skip↔planned only — no "owned" there).
- **Add-goal palette**: the toolbar search button and Ctrl/Cmd+K open a
  floating fuzzy-search palette (`#palWrap`) over characters + weapons.
  `fuzzyScore` (engine, pure, tested) is subsequence matching with gap/
  offset/length penalties. Already-queued AND completed characters are
  HIDDEN from results (user choice — no jump-to-editor; a completed char
  comes back via ↩ on the Completed tab); weapons always add. Results
  group as 5★ chars · 4★ chars · 5★/4★/3★ weapons (fuzzy rank within a
  group) with faint rarity row tints (`.pal-item.rN`). Arrows navigate,
  Enter activates, Esc/backdrop close. The old inline add-menu is gone.
- **Editor skill controls**: each skill column has −/+ pairs under BOTH the
  current and target selects (`data-skc/sks/skd`), plus the bulk ±1 gutters
  flanking the grid. The goal editor deliberately has no bottom legend and
  no save-as-default button — the toolbar "Templates" pop-up is the single
  place templates are edited.
- **Completed goals**: a card whose cost is empty (current meets target)
  grows a ✓ button that moves the goal from `state.goals` to `state.done`
  (full goal objects, state intact). The **Completed summary tab** lists
  them as single-line `.goalstat` rows: icon · name · rarity/level · for
  characters also achieved forte levels ("forte all 6" when uniform, else
  "10/10/8/8/6") and a **node indicator** (`.nodechk`) — a diamond lit when
  the build's OWNED node counts cover the per-rarity template's plan
  (`nodeShortfall(cur, tpl)`, pure/engine, count-based since templates
  don't record columns; tooltip names any gap). It's a LIVE comparison:
  editing a template re-grades every completed build — deliberate ("does
  this build meet my current standard?"). Row buttons: ↩ (restore to queue
  end — raise the target to keep building) and ✕ (forget; the char becomes
  addable again). A character exists at most once across queue + done;
  `sanitize()` lets the queued copy win.
- **Save format** lives in localStorage key `wuwa-planner-v1`. `sanitize()`
  migrates all older generations (v1 counts → v2 `{minor,major,inh}` arrays →
  current matrix) and repairs illegal states. Later-added top-level fields:
  `done` (completed goals) and `hideUn` (Inventory-tab filter) — both
  default safely when absent. Never break old-save loading; add migrations
  instead. Storage is normalized (rewritten) once at boot.

## Game data provenance (do not silently change numbers)

All quantities were verified against the game's own config tables from the
Dimbreath/WutheringData datamine repo (ConfigDB: `RoleBreach`, `SkillLevel`,
`RoleLevelConsume`, `RoleExpItem`, `WeaponBreach`, `WeaponLevel`,
`WeaponExpItem`), cross-checked with Game8/wiki totals. Anchor totals for a
full 5★ build (Lv1→90, all forte 10, both inherents, all 8 nodes):

- boss 46 · specialty 60 · weekly 26
- forge tiers 25/28/55/67 · common tiers 29/40/52/61
- credits 3,053,300 (= 170k ascension + 2,030k forte + 853.3k leveling)
- EXP 2,438,000 · credit-per-EXP 0.35 · potions 1k/3k/8k/20k

The engine test suite asserts these exactly — if a data edit breaks them,
the edit is wrong (or the game changed; re-verify before touching tests).

Weapon anchor totals (full Lv1→90, ascension + leveling; verified against
the WeaponBreach/WeaponLevel/WeaponExpItem datamine tables, cross-checked
with Game8 per-rank pages and wuthering.gg):

- 5★: ascension credits 330,000 · forge tiers 6/8/6/20 · enemy 6/6/10/12 ·
  EXP 2,692,400 (rank 1 uses no forge mat)
- 4★: ascension credits 264,000 · forge tiers 5/7/5/17 · enemy 5/5/9/11 ·
  EXP 2,289,200 (all 4★ weapons share one WeaponBreach table)
- credits-per-EXP is 0.4 for both rarities (energy cores are
  rarity-independent: 400/1,200/3,200/8,000 credits per core)
- energy cores mirror potions exactly: 1k/3k/8k/20k EXP, rarities 2–5

A weapon's FORGERY family is fixed by weapon type within a region
generation (1.x/2.x: Broadblade→waveworn, Sword→drip, Pistols→phlogiston,
Gauntlets→cadence, Rectifier→helix; 3.x Rikka sets: →carved, →polarizer,
→combustor, →wshard, →strings); the ENEMY family is per-weapon. Verify both
when seeding a weapon.

**The full 4★/5★ weapon catalog through 3.5 is seeded** (89 entries: 46 5★ +
43 4★, incl. the 3.4 Cyberpunk collab pair and the crafting series with
their real `#`-names, e.g. "Broadblade#41"). Families were verified per
weapon from the fandom wiki's "Ascends with" page categories (fetched via
the MediaWiki API — page HTML is Cloudflare-blocked, the API is not), with
wuthering.gg/Game8 filling the gaps (3.0 standard pool, 3.4 collab, Fusion
Accretion) and spot-checks on single-source rows. 1★–3★ weapons are
deliberately omitted. All families mapped onto the already-seeded
`GAME.families` — the material registry did not grow. Azure Oath (Xuanling
signature) is 3.5 beta data like Firstlight's Herald: quantities are
template-locked, family (polarizer/mech, matching every other 3.x sword)
from beta guides — both carry `beta:true`; confirm at launch. Engine test
"11c" locks the catalog shape (89/46/43, well-formed entries, unique names)
plus a 3.x-generation cost anchor (Everbright Polestar).

**Suisui is 3.5 beta data** (release 2026-07-10): quantities are
template-locked, but the "Autopuppet Kernel I–IV" tier names are
placeholders — verify at launch and update `GAME.families.kernel` and her
entry. Her strings forge family and the exoswarm enemy family are live-game
canon already (Lahai-Roi, 3.x) — only kernel remains unverified. Her
signature weapon "Firstlight's Herald" is also beta-named (an older leak
translation called it "Dew Imbiber") — confirm the English name at launch.
Both carry BETA badges in the UI; remove them when confirmed.

## Icons

No images are embedded. Icons resolve from a local folder by convention:
`GAME.icons` = `{dir:'images/', kinds:{char:'characters/', mat:'materials/',
weapon:'weapons/'}, exts:['png','webp','jpg'], overrides:{}}` — kind subfolder
is picked by what the icon is for. Slug rule: lowercase display name, drop
apostrophes, non-alphanumeric runs → `_`, suffix `_icon` (e.g. "Loong's
Pearl" → `images/materials/loongs_pearl_icon.png`, character "Jinhsi" →
`images/characters/jinhsi_icon.png`). Extensions are tried in order via
error-listener chaining (`bindIcons`/`icoFail`); final fallback is the
built-in rarity dot / element monogram, so missing files must never break
layout. `overrides` maps display name → base filename (no extension).
Weapons reuse this same pipeline (kind `weapon` → `images/weapons/`).

## Testing (non-negotiable workflow)

Two Node suites live next to the HTML and **eval the shipping file itself**
(no separate source of truth):

- `test-engine.js` — extracts script blocks 0–1 only (block 2 touches the
  DOM and must stay excluded), joins them into a **single** eval (separate
  evals break `const` scoping — this bit us twice), asserts the anchor
  totals above plus partial ranges, synthesis, inventory, and walk logic.
- `test-ui.js` — jsdom (`runScripts:'dangerously'`), simulates real clicks:
  tabs, selects with clamping, inventory inputs, drag & drop (synthetic
  events; jsdom rects are 0 so drops resolve "before"), node-tree cascades,
  icon fallback chain, save/reload round-trips, corrupt-save recovery, and
  every migration generation. Object comparisons must be key-order-
  insensitive (`canon()` helper).

Run both after **any** change: `node test-engine.js && node test-ui.js`.
Every new feature ships with tests in the same turn. jsdom is installed via
npm; puppeteer is unavailable in the sandbox (Chrome CDN blocked), so there
are no screenshot tests — be extra careful with CSS-only changes.

## UI conventions

- Aesthetic: dark "resonance" theme; CSS custom props in `:root`; fonts
  Chakra Petch (display) + IBM Plex Sans (body); rarity colors r2–r5;
  tabular numerals for quantities. Keep the waveform header motif.
- **Layout:** sticky summary panel on the LEFT (5fr), priority queue on the
  RIGHT (7fr) as a 2-per-row card grid (`#goals`, CSS auto-fill → 1 column
  when narrow; at ≤940px the page stacks with goals first via `order`).
- **Materials render as icon tiles**, not lists: rarity-tinted ground
  (`.tile.r0–r5`, game convention green/blue/purple/gold), abbreviated qty
  on the tile (`fmtShort`, pure/engine: 3 sig figs, K/M from 10,000 up),
  name + exact amounts + potion/core plan in the hover `title`. The
  **Inventory tab keeps its table** (Need/Have/Left + inventory inputs) and
  lists EVERY registry material — un-needed rows show '—' and no Left cell,
  so stock can be logged ahead of goals; it renders even with an empty queue
  (tab key in saves is still `left`). A "Hide un-needed" checkbox
  (`state.hideUn`, persisted) collapses it to the needed set — row
  visibility may depend on goals + that toggle but NEVER on inventory
  (the `updateLeft` in-place patch relies on this).
- **Tiles show the deficit after inventory** (`deficitTiles`): goal cards
  allocate the pool in queue order (renderGoals runs `farmNextWalk`, so the
  first card that needs a material eats the stock and later cards see the
  leftovers — no crafting, same rule as the Farm next tab); the Total tab
  nets the aggregate via `remainingBag` (synthesis-aware). Covered mats stay
  visible as a dimmed ✓ (`.tile.done`), with the full requirement in the
  tooltip. Farm next's own missing-list still uses plain `matTiles`.
- **Cards are read-only status views**: header + mini forte tree (`miniTree`,
  span-based, no handlers) with per-column skill levels cur→tgt + an
  always-visible materials tile grid (`goalMats`). All editing happens in the ✎
  pop-up (`#modalWrap`/`renderModal`): level row plus a game-view forte grid
  where each skill column stacks its two nodes above its level selects.
  Live apply — modal controls reuse `onField`/`onNode`, which save+render;
  `render()` re-renders the open modal in place. `editIdx` is transient
  (never persisted); Esc/backdrop/✕ close; deleting the edited goal closes.
  `goal.open` still exists in saves but is legacy/unused.
- Rendering is "state changes → full re-render" via `render()` — EXCEPT
  inventory/synth edits, which patch the Inventory tab's computed cells in
  place (`updateLeft`: Left cells via `data-l`, pooled-EXP Have via `data-h`,
  potion/core plan rows via `data-p`). Rebuilding the table there would
  destroy the input the user is tabbing into and dump focus to the top of
  the page, so keep row structure dependent on goals only, never on
  inventory. Event handlers bind after each render; data attributes carry
  indices, never material ids (apostrophes in names).
- Reordering: drag the ⠿ grip (HTML5 DnD, `dragIdx` module variable — not
  dataTransfer — carries state) **and** ▲▼ buttons, kept for touch screens.
  Both route through `moveGoal(from, to)` where `to` is the pre-removal
  insertion index.
- Summary tabs: Total / Inventory (inline inventory + 3→1 synthesis toggle
  + hide-un-needed toggle) / Farm next (sequential allocation, deliberately
  no crafting — a craft spent on goal 1 would silently eat goal 2's stock;
  this is documented in-app) / Completed (finished goals; tab label carries
  a count when non-empty).
- localStorage is unavailable in the claude.ai artifact preview iframe —
  the app detects this and shows a "preview mode" note. Never assume storage
  works; everything must degrade to in-memory + Export/Import.

## Roadmap / open items

1. **3.5 launch checkpoint (2026-07-10):** confirm Suisui AND Xuanling
   materials/names (esp. the "LF/MF/HF/FF Autopuppet Kernel" tier pattern,
   Cloudperch Seed, Skyward Glazed Heart, Solidarity's Loneflame) and the
   signature weapon's English name ("Firstlight's Herald" vs launch rename);
   drop the beta badges. Same for Azure Oath (Xuanling's sword, `beta:true`):
   confirm the name and its polarizer/mech families at launch.
   Also spot-check Rebecca's weekly (We Who Question)
   and forge (Combustor) — single-source cells from the roster sweep.
   Missing image checklist: `images/missing_icons.md` (10 beta files) — run
   `node fetch-icons.js` after launch to pull them from the fandom wiki
   (icon source of record: files named `Item/Resonator/Weapon <Name>.png`,
   resolved via the MediaWiki API; page fetches are Cloudflare-blocked but
   the API and static.wikia CDN are not; payloads are WebP saved as .png).
   Note: the Dimbreath/WutheringData datamine is abandoned at 3.1.0 — verify
   post-3.1 data via Game8/prydwen instead.
2. Backlog (user-approved ideas, unscheduled): waveplate-cost estimates,
   optional synthesis in Farm Next, optional per-character stat labels on
   tree nodes (declined for now — cosmetic), Echo XP/tuners as a separate
   section. No farming-schedule/day-of-week features — WuWa domains are
   always open (user-confirmed).

## Working agreements with this user

- Discuss plans before large implementations; they review and redirect.
- Verify game data with sources (datamine > wiki > guides) rather than
  memory; new/unfamiliar names (post-cutoff characters) must be searched.
  Trusted sources: Dimbreath/WutheringData datamine, Game8, wuthering.gg,
  the fandom wiki, and prydwen.gg (user-endorsed).
- The user plays the game and is the authority on in-game mechanics — when
  they correct a rule (as with node dependencies), trust the correction.
- Keep responses concrete about what changed, what was tested, and any
  honest limitations of the change.