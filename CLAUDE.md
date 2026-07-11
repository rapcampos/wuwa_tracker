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
- **Forte stat bonuses:** each character's tree grants two stats, named in
  `GAME.charStatNodes[charId] = [outer, inner]` (the four stat columns are
  symmetric — cols 0 & 4 carry the outer stat, 1 & 3 the inner; col 2 is the
  Circuit/inherent, no stat). Per-stat percentages live in `GAME.nodeStats`
  (`{minor, major, label}`, shared by all characters like the cost
  templates; minor = lower node, major = upper). `statNodesFor(charId)`
  (engine, pure) returns `[outer, inner, null, inner, outer]` indexed to the
  matrix columns, or `null` when the character has no datamined node data.
  `forteStatTotals(goal, side)` (engine, pure) sums a build's grant across
  its owned stat nodes: `side='cur'` counts only OWNED (===2), `'tgt'`
  (default) counts PLANNED-or-owned (≥1); returns an ordered
  `[{key,label,pct}]` (outer stat first, float-clean), `[]` for a zeroed
  build, `null` for weapons / data-less characters. Values datamined from
  ConfigDB/SkillTree.json (Dimbreath ≤3.1) — anchors: total forte crit rate
  8%, crit dmg 16%. **Coverage: 35 of the 5★ roster; NOT yet keyed** (return
  null) are 8 post-3.1 5★ (denia, hiyuki, lucilla, lucy, rebecca, sigrika,
  suisui, xuanling) and ALL 4★ — add from Game8/wiki as verified, keeping
  the engine test's "every keyed character is 5★" invariant in mind.
  Surfaced **only** in the edit pop-up: `forteStatLine(g)` renders a
  target-build "Forte grants +8% Crit Rate · +12% ATK" line under the forte
  grid (`.fstat`), re-rendered live as nodes toggle, empty-state text rather
  than vanishing, nothing at all for data-less characters. Deliberately NOT
  on goal cards (user choice, Jul 2026).
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
  **Right-click (or Shift+Enter) adds the goal maxed** — `palActivate(it,
  max)` runs `maxTarget(goal)`, the same transform behind the editor's
  ⤒ Max target button (Lv90 · skills 10 · every node at least planned).
  Weapons already target Lv90 from `newWpnGoal`, so `max` is a no-op for
  them. `#palHint` advertises it, and hides in team-pick mode (no "maxed"
  concept when filling a slot).
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
- **Teams (matrix team builder)**: a second page (`#pageTeams`, header nav
  "Ledger | Teams", `location.hash === '#teams'` routing — nav clicks call
  `showPage` directly so jsdom needs no hashchange event; boot calls
  `showPage(curPage())`). `state.teams` = `[{name?, chars:[charId|null ×3]}]`;
  roster = queued + completed characters (`rosterGoals()`, weapons excluded).
  Teams render as cards in an auto-fill grid (`.tgrid`, min 185px), members
  stacked vertically inside each card. Each character has an **energy
  budget** — optional `energy` field on the GAME entry capping total
  placements across teams; default 1 = one team total, and the user's six
  supports are seeded with `energy: 2` (verina, shorekeeper, suisui, chisa,
  mornye, buling — user-confirmed list, Jul 2026; other owned healers like
  Baizhi/Youhu get 2 only if the user asks). Engine (pure, tested):
  `charEnergy`, `teamUsage`, `energyLeft`, `sanitizeTeams` (drops non-roster
  ids, dedupes within a team, enforces the budget with earlier teams
  winning, clamps/pads slots to 3; `name` survives only as a non-empty
  string — the UI shows positional "Team N" when absent). Empty slots open
  the add palette in **pick mode** (`palPick = {t,s}`; roster-only entries,
  cleared by `closePal`); clicking a filled slot empties it. Deleting a
  queued goal or forgetting a completed one calls `pruneTeams()` (marking
  done does NOT — still rostered). Teams are planning-only: no effect on
  costs, totals, or the queue.
- **Save format** lives in localStorage key `wuwa-planner-v1`. `sanitize()`
  migrates all older generations (v1 counts → v2 `{minor,major,inh}` arrays →
  current matrix) and repairs illegal states. Later-added top-level fields:
  `done` (completed goals), `hideUn` (Inventory-tab filter), `skipCE`
  ("Ignore credits & EXP"), and `teams` (Teams page) — all default safely
  when absent. Never break old-save loading; add migrations instead.
  Storage is normalized (rewritten) once at boot.

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

**Waveplate yields (`GAME.waveplates`)** are endgame (UL70/SOL3-8) averages
from the community drop-rate project (WuWa Data Gathering discord's sheet,
linked from the wiki's Boss/Weekly Challenge pages; costs cross-checked on
the wiki): boss 60⚡ → 4.5 mats (n=335), weekly 60⚡ → 3 mats + 3 claims/week
cap, forgery 40⚡ → 51 tier-0 equivalents at domain lv90 (n=2610), sims 40⚡ →
78,440 resonator EXP / 79,059 weapon EXP / 84,000 credits. These are
crowdsourced averages, not datamine — softer numbers than the cost tables;
engine test 19b anchors them (full 5★ char ⌈5723.08⌉ = 5,724⚡ ≈ 23.85 days;
full 5★ weapon 2,522⚡). `waveplateEstimate(bag)` books each material to its
dedicated activity and ignores side drops, so real farming lands slightly
under the estimate; specialty + enemy commons are overworld (0⚡), returned
in `overworld`.

**The full 4★/5★ weapon catalog through 3.5 is seeded** (89 entries: 46 5★ +
43 4★, incl. the 3.4 Cyberpunk collab pair and the crafting series with
their real `#`-names, e.g. "Broadblade#41"). Families were verified per
weapon from the fandom wiki's "Ascends with" page categories (fetched via
the MediaWiki API — page HTML is Cloudflare-blocked, the API is not), with
wuthering.gg/Game8 filling the gaps (3.0 standard pool, 3.4 collab, Fusion
Accretion) and spot-checks on single-source rows. 1★–3★ weapons are
deliberately omitted. All families mapped onto the already-seeded
`GAME.families` — the material registry did not grow. Azure Oath
(Yangyang: Xuanling's signature) was launch-verified 2026-07-10 via Game8
(polarizer forge, mech enemy family — beta dropped). Firstlight's Herald
(Suisui signature) keeps `beta:true`: the NAME is confirmed (wiki page
exists) but its exoswarm enemy family is still single-sourced from beta —
re-verify at her release (2026-07-30). Engine test "11c" locks the catalog
shape (89/46/43, well-formed entries, unique names) plus a 3.x-generation
cost anchor (Everbright Polestar).

**3.5 data was launch-checked 2026-07-10** against Game8 + the fandom wiki
(quantities matched the shared templates exactly — a good sanity anchor).
Confirmed: kernel tier names are **"Autopuppet Kernel (LF/MF/HF/FF)"**
(parenthesized suffix, NOT the beta "LF Autopuppet Kernel" prefix);
Xuanling's official EN name is **"Yangyang: Xuanling"** (a 5★ Yangyang
variant — entry key stays `xuanling`); Solidarity's Loneflame, Cloudperch
Seed, Flowborne Dream, and Skyward Glazed Heart all shipped under their
beta names; Rebecca's weekly/forge spot-check passed. Suisui herself
releases **2026-07-30** (3.5 act 2) — her materials are confirmed, so her
beta badge is gone; only Firstlight's Herald still carries one.

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

The **inline waveplate glyph** `wpIco()` reuses this pipeline for a non-`MATS`
name — `icoImg('Waveplate', 'mat', 'wp-ico')` → `images/materials/
waveplate_icon.png` (fetched from the fandom wiki like the rest) — and
replaces the old `⚡` text everywhere waveplate quantities render: the card
readiness labels, the Total-tab estimate line, and the today-plan
header/rows/note. Sized to text via `.wp-ico`. Tooltips still spell out
"waveplates" (title attributes can't carry an `<img>`), and the `⚡` in the
data-provenance numbers below is just prose.

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
  **Per-block isolation:** the first ~400 lines are ONE deliberate
  integration narrative (boot → edit → reorder → remove/re-add → inventory
  accumulates → a persistence round-trip that asserts that exact accrued
  state) — do not `reset()` inside it. EVERYTHING below the round-trip is an
  independent feature block that calls the `reset()` helper first: it
  rebuilds the default Jinhsi/Phoebe/Suisui queue from STANDARD templates,
  clears inventory/done/teams/undo, closes every pop-up, and returns to the
  Ledger page's Total tab. A block needing more (stock, a completed goal, a
  weapon at index 3) sets it up explicitly right after resetting, so no
  block's preconditions depend on run order — a leaked toggle or a drained
  queue in one block can't corrupt the next (a hostile-leak injection test
  proved every downstream block survives). Blocks that spin their own
  throwaway `JSDOM` (migrations, weapon corrupt-saves, empty-queue, backup
  staleness, teams hash-boot) are already isolated and skip `reset()`. When
  a block mutates a GLOBAL (`GAME.icons.overrides`), undo it in the block —
  `reset()` only restores `state`, not `GAME`.

Run both after **any** change: `node test-engine.js && node test-ui.js`.
Every new feature ships with tests in the same turn. jsdom is installed via
npm; puppeteer is unavailable in the sandbox (Chrome CDN blocked), so there
are no screenshot tests — be extra careful with CSS-only changes.

## UI conventions

- Aesthetic: dark "resonance" theme; CSS custom props in `:root`; fonts
  Chakra Petch (display) + IBM Plex Sans (body); rarity colors r2–r5;
  tabular numerals for quantities. Keep the waveform header motif.
- **Layout:** sticky summary panel on the LEFT, priority queue on the RIGHT
  as a card grid. The summary column is **bounded, not proportional**
  (`minmax(320px,400px) minmax(0,1fr)`): the old `5fr/7fr` split pinned the
  goals column near 750px — exactly two cards — however wide the window was.
  With `.wrap` at `max-width:1800px` and a 320px card track, `#goals`
  auto-fills 2 → 3 → 4 cards per row as the window grows (1 when narrow; at
  ≤940px the page stacks with goals first via `order`). A jsdom test guards
  the three grid declarations — there are no screenshot tests, so CSS
  regressions here are otherwise invisible.
- **Materials render as icon tiles**, not lists: rarity-tinted ground
  (`.tile.r0–r5`, game convention green/blue/purple/gold), abbreviated qty
  on the tile (`fmtShort`, pure/engine: 3 sig figs, K/M from 10,000 up),
  name + exact amounts + potion/core plan in the hover `title`, and every
  material tooltip (tiles, Inventory rows, stock grid) ends with
  "· needed by <goal names>" — the `NEEDERS` map (`{id: [{name, kind}]}`,
  kind = char|weapon), rebuilt once per render pass by `buildNeeders()`
  (tests must match tile titles by prefix, not equality; `neederNames(id)`
  gives the text, so the title string is unchanged) — then "· click to log
  drops": **clicking any `.tile` opens the farm pop-up on that material's
  family** (`bindTileClicks` recovers the id from the tooltip's leading
  display name — data attributes must not carry ids). The Inventory tab's
  row icons (`td.matcell`) are the same door.
- **Hover popover** (`#tipPop`, `showTip`/`hideTip`): hovering any `.tile`
  opens a small floating card (position:fixed, z-index 80, pointer-events
  none) showing the tooltip text header PLUS the needers as **avatar chips**
  (`.tip-chip` with an `icoImg` face, char or weapon folder by `kind`) —
  native `title` can't carry images. While it's up the tile's own `title`
  is stashed (`tipTitle`) and removed so the browser doesn't also pop its
  default tooltip; `hideTip` (on mouseleave, and at the top of `render()`
  for stale-popover cleanup) restores it. Only ONE tile is hovered at a
  time (`tipTile`). The click handler reads the stashed title when the
  clicked tile is the hovered one. Scoped to `.tile` (cards, Total, Farm
  next); the stock grid (`.itile`) and Inventory rows keep plain `title`s.
  **exp/wexp tiles show a top-tier item count, not raw EXP** (`expTopTier`/
  `wexpTopTier`, pure/engine: ceil ÷ 20k — "366", not "7.31M"; `tileQty`
  routes it), and the registry marks exp/wexp `r:5` so the ground matches
  the Premium potion/core icon the tile carries; exact EXP stays in the
  tooltip, and the Inventory tab's pooled rows still use raw EXP numbers
  (they sit next to per-tier inputs). The
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
  leftovers — same rule as the Farm next tab). With the synthesis toggle
  on, the walk also CRAFTS (`farmNextWalk(goals, inv, craft)` → pure
  `craftFromPool`): each goal may cover family-tier deficits 3→1 from pool
  surplus, but a `reserve` map holds every quantity any queued goal still
  needs directly at each tier — those are never crafted away ("have 22,
  need 10 → only 12 craft", user's rule). Chains (9× t0 → 1× t2) consume
  exactly, wasting nothing on a short chain; low-tier deficits craft
  before high. The Total tab nets the aggregate via `remainingBag`
  (synthesis-aware as before). Covered mats stay visible as a dimmed ✓
  (`.tile.done`), with the full requirement in the tooltip. The Inventory
  tab's synth checkbox therefore also refreshes the goals grid.
- **Cards are read-only status views**: header + mini forte tree (`miniTree`,
  span-based, no handlers) with per-column skill levels cur→tgt + an
  always-visible materials tile grid (`goalMats`). All editing happens in the ✎
  pop-up (`#modalWrap`/`renderModal`): level row plus a game-view forte grid
  where each skill column stacks its two nodes above its level selects.
  Live apply — modal controls reuse `onField`/`onNode`, which save+render;
  `render()` re-renders the open modal in place. `editIdx` is transient
  (never persisted); Esc/backdrop/✕ close; deleting the edited goal closes.
  `goal.open` still exists in saves but is legacy/unused.
- **Upgrade transactions** (goal editor, below the Max buttons — never in
  template mode): one row per next step — next level/ascension ordinal,
  +1 per skill, each purchasable forte node — with its exact cost
  (`costForGoal` between adjacent states) and an ⬆ button that spends
  inventory and advances `cur` by that one step, wrapped in `withUndo`
  (misclick = one Ctrl+Z). Affordability checks the user's **FULL stock —
  queue priority never gates spending** (user-explicit requirement; the
  walk's allocation is display-only), and with the synthesis toggle on it
  also **crafts lower tiers 3→1 to cover a missing tier** (the cost's own
  lower-tier lines are paid first; the button title announces "crafts
  lower tiers" when that will happen). Engine: `payPlan` settles a cost
  against a scratch inventory copy (crafting via `craftFromPool`, zeroed
  keys stripped); `affordCost` = its missing map, `spendCost` swaps the
  copy in atomically; `poolPlan` drinks potions/cores greedily with
  minimal overflow and previews in the title. Shortfalls land in the
  disabled button's tooltip. Node purchases respect the in-game gate: an
  upper node is offered only once its lower node is OWNED (Ⅱ only after
  Ⅰ). The plain cur/tgt selects stay free bookkeeping — they never touch
  inventory.
- Rendering is "state changes → full re-render" via `render()` — EXCEPT
  inventory/synth edits, which patch the Inventory tab's computed cells in
  place (`updateLeft`: Left cells via `data-l`, pooled-EXP Have via `data-h`,
  potion/core plan rows via `data-p`). Rebuilding the table there would
  destroy the input the user is tabbing into and dump focus to the top of
  the page, so keep row structure dependent on goals only, never on
  inventory. The goals grid catches up on **blur** of an inventory input
  (`invDirty` flag → `renderGoals()` — safe because only `#goals` is
  rebuilt, focus lives in the summary table; multiple edits to one field
  coalesce into one refresh). Event handlers bind after each render; data
  attributes carry indices, never material ids (apostrophes in names).
- **Inventory pop-up** (`#invWrap`, toolbar "☷ Stock" or Ctrl/Cmd+I): the
  fast bulk-entry surface — every registry item as a rarity tile (icon +
  quantity input; name and need/left in the hover title; potions/cores are
  plain items here, no pooled rows) in category sections, with the same
  persisted synth/hide-un-needed toggles as the tab. Within each section
  tiles sort **rarity high → low** (then family, then name) to mirror the
  in-game inventory — deliberately NOT `sortMatIds`, which stays
  low→high for the planning views. `IGRID` carries ids by index. The grid builds once per open and is NOT re-rendered on input
  (focus safety); CLOSING it (Esc/backdrop/✕, priority palette → reorder →
  stock → editor; Ctrl+K/P close it too) runs the full `render()`, which
  is the "apply everywhere when done" step. The Inventory tab stays as the
  Need/Have/Left report.
  A **fuzzy filter box** (`#invFind`, transient `invFilter`, reuses
  `fuzzyScore` — so "lfhow" finds LF Howler Core) is the way in: `openInv()`
  focuses it, and it rebuilds the grid per keystroke *safely* because the
  input sits in the header OUTSIDE `#invGrid`. Enter on a lone match jumps
  into its quantity input; `openInv`/`closeInv` clear the filter. Tiles here
  are **inert** — no click handler, no steppers: this grid is a typing
  surface, and per-family nudging belongs to the farm pop-up.
- **Farm pop-up** (`#farmWrap`, `openFarm(id)`): the after-a-run surface.
  Opened by clicking any material icon on the Ledger page (goal-card tiles,
  Total, Farm next, Inventory rows) and layered above every other pop-up
  (z-index 55; Esc order is palette → reorder → **farm** → stock → editor).
  It shows ONLY the clicked material's family — `familyIds` (pure/engine):
  a family's four tiers low→high, the potion or core ladder for anything in
  an EXP pool, otherwise the material alone (boss/specialty/weekly/credits
  are singletons). `famLabel` (pure/engine) titles it with the words the
  tiers share at one end — a suffix for "LF/MF/HF/FF Howler Core", a prefix
  for "Waveworn Residue 210/226/…"; a singleton labels itself. Each row is
  an input plus **`+1`/`+5`** (`.fstep`, Shift-click subtracts, clamped at
  zero) and a live need/left cell patched by `farmLeft()` — rows are never
  rebuilt, so the buttons stay under the cursor. Writes go through the one
  shared `setStock(id, v, inp)` (strips zeros); CLOSING runs the full
  `render()`, the same "apply everywhere when done" rule as the stock grid.
  `FARM` carries ids by index.
- Reordering: drag the ⠿ grip (HTML5 DnD, `dragIdx` module variable — not
  dataTransfer — carries state) **and** ▲▼ buttons, kept for touch screens.
  Both route through `moveGoal(from, to)` where `to` is the pre-removal
  insertion index. There's also a **reorder pop-up** (`#ordWrap`, toolbar
  "⇅ Reorder" or Ctrl/Cmd+P — preventDefault suppresses browser print): a
  compact vertical list where whole rows drag (`ordDrag` variable, separate
  from the cards' `dragIdx`) plus per-row ▲▼; live apply through the same
  `moveGoal`, and `render()` re-renders the open list via `renderOrder()`
  (no-op when closed). Ctrl+K/`openPal` closes it; Esc priority is palette →
  reorder → editor.
- Summary tabs: Total (aggregate deficit + waveplate line + the global
  "Ignore credits & EXP" toggle) / Inventory (inline inventory + 3→1
  synthesis toggle + hide-un-needed toggle) / Farm next (sequential
  allocation; crafting follows the synthesis toggle with reserved-tier
  protection — see the deficit-tiles bullet; the in-app note states which
  mode is active) / Completed (finished goals; tab label carries a count
  when non-empty).
- **Today's plan** (`dailyPlan`, pure/engine; `todayBox` renders it at the
  top of Farm next): splits one day's 240⚡ into WHOLE runs. It takes the
  walk's per-goal remainders in queue order, books each material to the
  activity that drops it (same rules as `waveplateEstimate`; forgery tiers
  collapse onto one domain, weighted 3× per tier), then buys runs one at a
  time — goal 0's activities first, and a shared activity is capped at the
  demand of the goals reached so far, so a later goal can't pull runs
  forward. Inside a goal it water-fills (largest remaining demand takes each
  run), **except that weekly bosses go first**: their 3-claims-per-week cap
  is use-it-or-lose-it, and a big forgery demand would otherwise crowd the
  claim out of the budget for good. Respects `skipCE` (it plans `viewBag`
  remainders). Overworld mats yield no runs and are named in the footnote.
- **"Ignore credits & EXP"** (`state.skipCE`, checkbox on the Total tab):
  a VIEW-level filter — `stripCE(bag)` (pure/engine) drops `credits`/`exp`/
  `wexp` before tiles, readiness bars, waveplate estimates, the Total
  aggregate, and Farm next's missing lists + READY flags. It never touches
  the truth: `costForGoal` output, the finished/✓-mark check (a goal
  needing only credits can't be marked complete by the toggle — cards say
  "Only credits & EXP left — ignored"), and the Inventory tab (stock
  logging keeps the real Need/Left numbers).
- **Readiness bars**: every unfinished goal card carries a thin waveplate
  progress bar under its header (`readyBar`: full requirement vs the
  queue-order-allocated remainder — same `farmNextWalk` data as the tiles),
  labeled "≈N·Xd" with the waveplate icon (`wpIco`, was ⚡) between the
  count and unit ("overworld only" when only free pickups remain);
  the tooltip (`wpTip`) splits the estimate by activity and notes the
  weekly 3-claims/week cap. The Total tab gets an aggregate line above the
  tiles. Finished goals render no bar.
- **Undo (multi-level)**: `withUndo(label, fn)` snapshots the whole state as
  JSON before a destructive mutation and pushes it onto `undoStack`, a ring
  buffer of `UNDO_MAX` = 20 (a snapshot is a few kB, so depth is cheap; the
  stack is transient — a reload starts empty). A bottom toast (`#undoBar`,
  auto-hides after 8s) always names what the NEXT undo reverts, with a
  "· N steps back" counter; `doUndo()` pops, restores through `sanitize()`,
  re-labels the toast from the step below, and also answers **Ctrl+Z**
  (skipped when focus is in an input/select/textarea — native undo wins
  there), so Ctrl+Z walks back through the stack. Wrapped actions: goal
  delete, forget-completed, team delete, upgrade purchase, Reset all,
  Import. Marking a goal done is NOT wrapped (↩ already reverses it).
- **Backup**: "⛃ Backup file" links a JSON file via the File System Access
  API (Chromium; button hides elsewhere) — every `save()` debounce-rewrites
  it (`scheduleBackup`/`writeBackup`), the handle persists in IndexedDB
  (`wuwa-planner-fs`), and a reload resumes silently only while the browser
  keeps the permission (otherwise the button relinks with one click, which
  satisfies the user-gesture rule). Export also stamps a backup. The stamp
  lives in a SEPARATE localStorage key `wuwa-planner-meta` (never inside
  the save); when it's over 7 days old the boot note nags with a warn tint.
- localStorage is unavailable in the claude.ai artifact preview iframe —
  the app detects this and shows a "preview mode" note. Never assume storage
  works; everything must degrade to in-memory + Export/Import.

## Roadmap / open items

1. **3.5 act-2 checkpoint (2026-07-30, Suisui's release):** re-verify
   Firstlight's Herald's exoswarm enemy family (drop its `beta:true`), and
   swap the ten stopgap icons for proper wiki files if uploaded by then —
   `images/missing_icons.md` has the list (8 materials currently from
   Game8's framed 120×120 icons, 2 weapons from wiki Full-art renders):
   delete the local files and re-run `node fetch-icons.js`. (Icon source
   of record: fandom wiki files `Item/Resonator/Weapon <Name>.png` via the
   MediaWiki API — page fetches are Cloudflare-blocked but the API and
   static.wikia CDN are not; payloads are WebP saved as .png; '#' and ':'
   are dropped from file names.) The 2026-07-10 launch checkpoint is done —
   see the provenance section. Note: the Dimbreath/WutheringData datamine
   is abandoned at 3.1.0 — verify post-3.1 data via Game8/prydwen instead.
2. Backlog (user-approved ideas, unscheduled): "buy all affordable steps"
   in the goal editor, Teams rename/reorder + "prioritize this team" queue
   reordering, `iconSlug` duplicated between the app and `fetch-icons.js`,
   legacy unused `goal.open`. **Not doing:** Echo XP / tuners (user declined,
   Jul 2026). No farming-schedule/day-of-week features — WuWa domains are
   always open (user-confirmed). Per-block test isolation via `reset()` is
   DONE (see Testing).

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