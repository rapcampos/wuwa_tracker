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
  (Shell Credits) and `exp` (raw Resonator EXP). Family materials are
  `<familyId><tierIndex 0-3>` (e.g. `howler2`); named mats are prefixed
  `boss:`, `spec:`, `wk:` + display name — the `wk:` keying is what makes a
  shared weekly (Sentinel's Dagger: Jinhsi + Phoebe) merge in totals.
- **Cost templates are shared per rarity.** Every 5★ character costs the same
  amounts; a character entry only names *which* materials it uses (boss,
  specialty, weekly, common family, forge family). Adding a new character is
  one small entry in `GAME.characters` — never duplicate cost tables.
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
- **Save format** lives in localStorage key `wuwa-planner-v1`. `sanitize()`
  migrates all older generations (v1 counts → v2 `{minor,major,inh}` arrays →
  current matrix) and repairs illegal states. Never break old-save loading;
  add migrations instead. Storage is normalized (rewritten) once at boot.

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
Weapon templates (5★: 330k credits; EXP total 2,692,400; 0.4 credits/EXP)
are already in `GAME` awaiting the weapons UI.

**Suisui is 3.5 beta data** (release 2026-07-10): quantities are
template-locked, but material *names* (esp. "Autopuppet Kernel I–IV" tier
names) are placeholders — verify at launch and update `GAME.families.kernel`
and her entry. She carries a BETA badge in the UI; remove it when confirmed.

## Icons

No images are embedded. Icons resolve from a local folder by convention:
`GAME.icons` = `{dir:'icons/', exts:['png','webp','jpg'], overrides:{}}`.
Slug rule: lowercase display name, drop apostrophes, non-alphanumeric runs →
`_`, suffix `_icon` (e.g. "Loong's Pearl" → `loongs_pearl_icon.png`,
character "Jinhsi" → `jinhsi_icon.png`). Extensions are tried in order via
error-listener chaining (`bindIcons`/`icoFail`); final fallback is the
built-in rarity dot / element monogram, so missing files must never break
layout. `overrides` maps display name → base filename (no extension).
Weapons must reuse this same pipeline when added.

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
- Rendering is "state changes → full re-render" via `render()`; inventory
  edits re-render only the summary. Event handlers bind after each render;
  data attributes carry indices, never material ids (apostrophes in names).
- Reordering: drag the ⠿ grip (HTML5 DnD, `dragIdx` module variable — not
  dataTransfer — carries state) **and** ▲▼ buttons, kept for touch screens.
  Both route through `moveGoal(from, to)` where `to` is the pre-removal
  insertion index.
- Summary tabs: Total / Remaining (inline inventory + 3→1 synthesis toggle) /
  Farm next (sequential allocation, deliberately no crafting — a craft spent
  on goal 1 would silently eat goal 2's stock; this is documented in-app).
- localStorage is unavailable in the claude.ai artifact preview iframe —
  the app detects this and shows a "preview mode" note. Never assume storage
  works; everything must degrade to in-memory + Export/Import.

## Roadmap / open items

1. **Weapons** (next feature): engine support is trivial (templates + curves
   already in `GAME`; no forte tree — level + ascension only), needs weapon
   goal type, card variant, seeded weapons (verify each weapon's forge/common
   families via search before encoding), tests. Icons follow the same slug.
2. **3.5 launch checkpoint (2026-07-10):** confirm Suisui materials/names,
   drop the beta badge.
3. Backlog (user-approved ideas, unscheduled): day-of-week forgery hints,
   waveplate-cost estimates, optional synthesis in Farm Next, "set current =
   target" quick action, optional per-character stat labels on tree nodes
   (declined for now — cosmetic), Echo XP/tuners as a separate section.

## Working agreements with this user

- Discuss plans before large implementations; they review and redirect.
- Verify game data with sources (datamine > wiki > guides) rather than
  memory; new/unfamiliar names (post-cutoff characters) must be searched.
- The user plays the game and is the authority on in-game mechanics — when
  they correct a rule (as with node dependencies), trust the correction.
- Keep responses concrete about what changed, what was tested, and any
  honest limitations of the change.