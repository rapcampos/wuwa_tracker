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
  8%, crit dmg 16%. **Coverage: 54 characters keyed** (the original 35 plus 19
  added Jul 2026: 7 post-3.1 5★ + all 12 4★, Game8/Wutheringlab-verified).
  **4★ trees grant the SAME node values as 5★** (verified per-node — Lumi's
  Crit Rate +1.2/+2.8, ATK +1.8/+4.2 match Jinhsi exactly), so `GAME.nodeStats`
  stays shared; only the stat TYPE varies per character. Only **suisui** is
  still un-keyed (low-confidence, unreleased — see the 3.5 act-2 checkpoint).
  The engine test no longer requires keyed characters to be 5★.
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
- **Shortcuts cheat sheet** (`#keysWrap`, Ctrl/⌘+/ or the toolbar "⌨ Shortcuts"
  button): a NON-BLOCKING reference panel anchored bottom-right — the page stays
  usable behind it (the wrap is `pointer-events:none`, only `.keys-pop` catches
  clicks), so it can float as a live lookup over any other pop-up. `openKeys`
  deliberately does NOT close the others. Content is the `KEYS` table (grouped
  rows of keycaps + description — a new shortcut is one row); `<kbd>` renders as
  keycaps. Esc treats it as the top layer (closes it before the palette beneath).
  This is the one place the keyboard/right-click-only power features are written
  down. No persistence — a reload starts closed.
- **Add-goal palette**: the toolbar search button and Ctrl/Cmd+K open a
  floating fuzzy-search palette (`#palWrap`) over characters + weapons.
  `fuzzyScore` (engine, pure, tested) is subsequence matching with gap/
  offset/length penalties. Already-queued AND completed characters are
  HIDDEN from results (user choice — no jump-to-editor; a completed char
  comes back via ↩ on the Completed tab); weapons always add. Results
  group as 5★ chars · 4★ chars · 5★/4★/3★ weapons (fuzzy rank within a
  group) with faint rarity row tints (`.pal-item.rN`). Arrows navigate,
  Enter activates, Esc/backdrop close. The old inline add-menu is gone.
  **Filter chips** (`#palFilt`, add mode only — a pick mode hides the row):
  rarity 5/4/3 · the six element glyphs · the five weapon-type glyphs, from the
  engine's `ELEMENTS`/`WTYPES` (derived from the roster, ALPHABETICAL —
  user's call, Jul 2026; the Echoes bar chips share them). The element and
  weapon-type groups each LEAD with an **"All" chip** (`.fchip.all`,
  `data-val=""`): lit while its facet is unfiltered, clicking clears just
  that facet (rarity has none — user asked for these two only).
  Transient `palFilt = {r, el, wt}` of Sets, cleared by `openPal`/`closePal`;
  within a facet the chips OR, across facets they AND (`palFiltPass`). An
  element chip implies characters (weapons have none); a weapon-type chip
  matches a character's `wtype` AND a weapon's, so it spans both groups.
  **Right-click (or Shift+Enter) adds the goal ALREADY BUILT** —
  `palActivate(it, built)` runs `maxGoal(goal)` (current → target: the
  template target for a character, Lv90 for a weapon) and pushes it straight
  to `state.done`, never the queue: it costs nothing, so a card would only
  sit there waiting for a ✓ click. `pulseDone()` flashes the Completed tab so
  you see where it landed. `#palHint` advertises it, and hides in any pick mode (no "maxed"
  concept when filling a slot). **`palPick` selects the mode** (null = the
  normal add palette): `{mode:'slot',t,s}` a team member (roster chars with
  energy left), `{mode:'owner',ref}` who carries this weapon goal — `ref` is
  the goal OBJECT, not a queue index, so the chip on a COMPLETED weapon
  (living in `state.done`) opens the same palette (any roster char),
  `{mode:'equip',char}` which LEDGER weapon a character carries —
  entries carry `ref`, the weapon-goal OBJECT, because duplicate weapon goals
  are legal and only the object identifies the copy. `PAL_PH` holds the
  per-mode placeholder; the equip mode's empty state distinguishes "no weapon
  in the ledger yet" from "every one is already carried".
- **Editor skill controls**: each skill column has −/+ pairs under BOTH the
  current and target selects (`data-skc/sks/skd`), plus the bulk ±1 gutters
  flanking the grid. The goal editor deliberately has no bottom legend and
  no save-as-default button — the toolbar "Templates" pop-up is the single
  place templates are edited.
- **Completed goals**: a card whose cost is empty (current meets target) grows
  a ✓ button that moves the goal from `state.goals` to `state.done` (full goal
  objects, state intact). **A "maxed" goal completes itself** — the editor's
  ✓ Max goal and the palette's right-click add both SAY the build is done, so
  they send it straight to `done` rather than parking a zero-cost card in the
  queue; every other route to zero cost (level edits, ⬆ purchases) still just
  offers the manual ✓, so nothing vanishes mid-edit (user's call, Jul 2026).
  `completeGoal(g)` flies the card out first (`.goal.leaving`, `LEAVE_MS` =
  380ms) and mutates state only when the flight lands, so the `withUndo`
  snapshot still holds the PRE-max build — one Ctrl+Z restores both the levels
  and the queue slot. `flushCompletion()` lands a goal still in the air (it
  fires when a second goal is maxed mid-flight, and the tests call it to skip
  the animation). `pulseDone()` flashes the Completed tab on arrival.
  The **Completed summary tab** is a GRID of portrait tiles (`.dgrid`/`.dcard`):
  big art, the name under it, rarity-tinted, and ↩ appearing only on hover —
  a finished build needs no numbers (user's call). It splits into **Characters
  and Weapons sections** (`.dsec` headers, each with a count and collapsible via
  `doneFold`, transient view state — a reload starts expanded), each sorted by
  rarity (5★ first) then alphabetically. The display order is NOT the stored
  order, so each tile carries its index into `state.done` for ↩. The level, forte levels and the **node-plan grade**
  (`nodeShortfall(cur, tpl)`, pure/engine — a LIVE comparison against the
  per-rarity template, so editing a template re-grades every completed build)
  all live in the card's tooltip. **↩ (restore to the queue) is the only
  action**: there is no "forget" button — in-game a build can't be un-done, and
  a mis-added completion is still removable with ↩ then ✕ on the card. A
  character exists at most once across queue + done; `sanitize()` lets the
  queued copy win.
- **Paused goals** (`goal.off`, ⏸/▶ on the card): the goal keeps its queue slot
  but takes part in NOTHING — no totals, no inventory allocation, no waveplate
  plan, no needer chips. The engine chokepoint is `activeGoals(goals)` (pure:
  drops `off` goals), which every UI call site passes instead of `state.goals`
  (`liveGoals()`); `farmNextWalk` is off-aware itself so its result stays
  index-aligned with `state.goals` — a paused goal yields `{off:true, rem:
  {...need}, ready:false}`, spends none of the pool and (with crafting on)
  RESERVES nothing. Its card is simply DIMMED (`.goal.off`; no badge — user's
  call, Jul 2026) and shows its FULL cost, which is exactly what resuming would
  take. Paused is a queue-only state: ✓ is withheld from a paused card and
  marking a goal done clears the flag (`sanitize` drops `off` inside `done`).
  Pausing/resuming is one click each way, so it is deliberately NOT wrapped in
  `withUndo`. All-paused is its own Total-tab empty state.
- **Character ⇄ weapon link** (`goal.owner` on a WEAPON goal = the character
  it is for): the link lives on the weapon, not the character, because weapon
  goals may be duplicated — pointing from the weapon is the only unambiguous
  direction, and it survives reordering (no indices). Only weapons already in
  the ledger (queued or completed) can be linked; a character carries at most
  ONE (`linkWeapon` unlinks the previous); and the **in-game type rule holds** —
  a Sword is only for Sword characters (`canCarry`, engine/pure; the
  `GAME.characters[].wtype` and `GAME.weapons[].wtype` vocabularies are the
  same five words, so it's a plain compare). Engine (pure, tested): `isWpn`,
  `equipOf(goals, charId)`, `canCarry(charId, wpnId)`,
  `sanitizeOwners(wpnGoals, rosterIds)` — repairs in place: an owner must be a
  roster character who can WIELD it, and may own one weapon, first claim in
  list order wins (the queue is passed ahead of `done`, so it wins).
  `pruneLinks()` (was `pruneTeams`) runs it plus `sanitizeTeams` whenever a
  character leaves the roster. Both palette link modes filter by weapon type
  and name it in the placeholder and the empty state. **The link is
  actionable EVERYWHERE it is shown** (user's rule — click assigns/changes,
  RIGHT-CLICK unlinks): the weapon card's **owner chip** (`ownerChip(g,
  attrs)` — the carrier's avatar on the meta line, faint ＋ when unlinked;
  queue cards hook it via `data-act="own"`/`data-g`, and the **Completed
  tab's weapon tiles carry the same chip** via `data-down` — index into
  `state.done` — top-left of the tile, ＋ hover-only there), the Teams
  page's roster weapon strip and each team slot's weapon icon
  (`teamSlot`; right-click = `unequip(charId)`, a shared helper that drops
  whatever queued-or-completed weapon the character carries), and the
  Echoes card header's weapon line (`.ehwpn`: click opens the equip
  palette, right-click unequips).
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
  the add palette in **pick mode** (`palPick = {mode:'slot',t,s}`; roster-only
  entries, cleared by `closePal`); clicking a filled slot empties it. Deleting
  a queued goal or forgetting a completed one calls `pruneLinks()` (marking
  done does NOT — still rostered). Teams are planning-only: no effect on
  costs, totals — EXCEPT via ⚑ Prioritize, below.
  **Page layout** (`.tcols`): the roster is a LEFT COLUMN of slim cards
  (`rosterCard`: avatar · name · current level · linked-weapon strip · energy —
  ONE vertical bar per point of budget, side by side, DRAINING LEFT TO RIGHT so
  what is still lit sits on the right; dimmed when out of energy, desaturated
  when the goal is paused, ✓ done for completed characters). Characters with
  energy left float to the TOP of the roster, spent ones sink (a stable sort, so
  each group keeps its ledger order). A **fuzzy filter box** (`#rosterFind`,
  transient `rosterFilter`, the same `fuzzyScore` as the palette and the
  inventory pop-up) narrows the panel and, once you type, ranks by match quality
  inside each energy group. It rebuilds per keystroke *safely* because the input
  sits OUTSIDE `#rlist` (`renderRosterList` redraws only the list, so focus
  survives) — the same rule the inventory pop-up follows. The DnD binder is split
  accordingly: `bindRosterCards` (drag sources + weapon strips, rebound per
  keystroke) vs `bindSlotDrops`/`bindTeamDnD` (bound once per render). A roster card is the drag source
  (`rosterDrag` → drop on a `.slot`, then `pruneLinks()` repairs an illegal
  drop); clicking an empty slot still opens the palette. Team cards carry a ⠿
  grip and drag to reorder (`teamDrag`/`moveTeam`) — **order is not cosmetic**:
  `sanitizeTeams` resolves the energy budget with EARLIER teams winning, so
  moving a team up can evict a shared support from one below it (the grip's
  tooltip says so). Teams are **auto-named after their first member**
  (`teamName`; positional "Team N" while slot 1 is empty) — the old custom
  `name` field is gone from the save and from `sanitizeTeams`.
- **⚑ Prioritize a team** (`prioritizeQueue`, engine/pure; `prioritizeTeam`
  wraps it in `withUndo` — it moves many goals, so one Ctrl+Z must undo it):
  the team's QUEUED characters move to the front of the queue **keeping the
  relative order they already had there** (user's rule), each followed by the
  weapon goal linked to them; everything else keeps its order behind that
  block. Moved goals RESUME if paused ("prioritizing means I'm building this
  now"). Completed members aren't in `state.goals` at all, so they're skipped
  for free; an unlinked weapon doesn't move. It returns `{goals, moved}` and
  mutates nothing — the caller clears `off`. Afterwards the UI switches to the
  Ledger (that's what changed) and drops `editIdx` (indices shifted).
- **Echoes page (per-character gear sheet)**: a third page (`#pageEcho`, nav
  "Ledger | Teams | Echoes"; `location.hash === '#echoes'` — routing widened to
  the `PAGES` list). Records the ECHO build a character wears; planning-only,
  like Teams — it never touches costs, totals, or the queue. `state.builds` =
  `{charId: {focus:[…], echoes:[{cost:1|3|4, main:<canonical key>,
  name:<free text>, set:<sonata|null>, subs:[{key,val}…≤5]} ×5]}}` — the `main` VALUE and each
  echo's flat SECONDARY are fixed by cost, so they're derived (`echoMainVal`,
  `GAME.echo.secondary`), never stored. The **lead echo is positional — always
  the FIRST echo** (no `lead` field; old saves with a `lead` index migrate by
  floating that echo to the front). Echoes carry a free-text `name` and are
  **drag-reordered** within a card by a ⠿ grip (`moveEcho`; dropping at index 0
  makes it the lead). The lead echo wears a subtle cyan SIDE BAR (`.ecol.lead`,
  left border only) — no LEAD tag or full highlight; position is the real
  signal, the bar a quiet cue. **No echo may hold two of the same substat**: a
  used key is filtered out of the echo's other substat dropdowns (`echoSubRow`'s
  `taken`), and `sanitizeBuild`/`readEchoSubs` dedupe by key (first wins). A build is materialized only on the first edit (`ensureBuild`);
  viewing a character renders a `freshBuild()` preview without saving. `pruneLinks`
  drops a build when its character leaves the roster; `sanitize` keeps only
  roster builds and repairs each via `sanitizeBuild`.
  Everything folds onto ONE canonical stat vocabulary
  (`GAME.echoStats`, ordered by `GAME.echoStatOrder`): flat vs percent are
  SEPARATE keys (`atk` = flat ATK, `atkp` = ATK%; `pct` flag drives formatting).
  **The Sonata set lives on each ECHO**, not the build — so 3pc+2pc (or
  2pc+2pc+1, or a straight 5pc) is representable. `setCounts`/`activeSets`
  (engine, pure) count pieces per set and report `[{name,count,need,on,k,v,thr}]`
  most-worn first; EVERY set with enough pieces contributes, so a 3pc+2pc build
  lands BOTH 2pc bonuses. Threshold is a hard rule (`setNeed`): the classic sets
  activate at 2, but the six newer ones are threshold-ONLY — 3pc (Flamewing's
  Shadow, Dream of the Lost, Law of Harmony, Crown of Valor, Thread of Severed
  Fate) or 1pc (Shadow of Shattered Dreams) — and grant NOTHING below it (their
  wiki infoboxes define no 2pc tier at all). Old single-set saves migrate the
  set onto every echo. The card shows one chip per set worn (`echoSetSummary`,
  `.eset` — lit when live) with its count and bonus.
  `buildTotals(build, forte)` (engine, pure) sums every echo's main + fixed
  secondary + substats, the active Sonata bonuses, and the forte grant
  (`forteStatTotals` output, mapped through `FORTE_CANON`) into one ordered
  `[{key,label,pct,val}]`. Only classic 2/5 sets contribute numerically;
  the six threshold-only sets carry `k:null` and add nothing yet.
  **Effect text**: every set carries `fx` ({p2,p5}, or {pt} for threshold-only)
  and every weapon carries `GAME.weaponFx[id]` = {n: R1 passive name, fx: text}.
  Both are DISPLAY-ONLY — every effect is conditional, so none is folded into
  totals. Surfaced as tooltips: `setTip` on the set chips + per-echo set select,
  `wpnTip` on the card's weapon line (which also shows the passive name inline).
  Weapon passives came from the fandom wiki's structured infobox rank-1 vars (R1
  guaranteed by construction, not eyeballed), cross-checked vs Game8 — which
  caught three wiki errors (Whispers of Sirens + Skull Thrasher carried another
  weapon's passive NAME; Emerald Sentence's R1 is 30%, not 12%).
  **"Sun-sinking Eclipse" is NOT a real set** — the wiki hard-redirects it to
  Havoc Eclipse; removed Jul 2026, which is why the catalog is **34**, not 35.
  Two 3.5 5pc percentages are unresolvable from open sources and marked DISPUTED
  inline (Heart of Evil's Purge 30 vs 20; Song of Feathered Trace 35/25/20) —
  settle them in-game. Firstlight's Herald's passive is a pre-release preview.
  **Final stats** (`finalStats`, engine/pure) fold those gear bonuses onto the
  character's Lv90 base (`GAME.charBase[id] = {atk,hp,def}`) and the LINKED
  weapon's base (`GAME.weaponBase[wpnId] = {atk, key, val}` — key a canonical
  main-stat key): ATK = (charATK + weaponATK)·(1+ATK%) + flatATK, HP/DEF
  likewise (weapon adds no base HP/DEF); Crit Rate = 5 + gear, Crit DMG =
  150 + gear, Energy Regen = 100 + gear (the universal bases); element/skill
  DMG + Healing show as their totals when present. Returns
  `{stats:[{key,label,pct,val}], weapon:bool}`, or **null** when the character
  has no base on file — then the card FALLS BACK to the gear-only breakdown
  (`echoTotalsPanel` picks: "Final stats" vs "Gear totals"). Base data verified
  Jul 2026 vs Game8 (cross-checked wuthering.gg); character base stats vary per
  character, and 4★ weapon secondary values come in grades tied to base ATK
  (not one-per-type). Coverage grows as data is verified — a missing character
  or weapon degrades gracefully (weapon excluded from ATK with a note).
  Percent vs flat stats are labelled distinctly (`atkp` = "ATK%", `atk` =
  "ATK"; same for HP/DEF) — the in-game convention — so a totals row like
  "ATK% 48.4%" never reads the same as "ATK 350".
  Engine (pure, tested): `freshBuild`, `freshEcho`, `sanitizeBuild`,
  `buildCost`, `echoMainVal`, `snapSub` (snaps a substat to the nearest legal
  roll), `buildTotals`, `echoCV` (Crit Value of one echo's SUBSTATS,
  2×CR + CD — mains/secondaries excluded, null without a crit substat;
  shown right-aligned on the echo's main-stat line, `.emval .ecv`). UI: **master-detail** (`.ecols`, mirroring the Teams
  split, Jul 2026 — replaced the old show-every-sheet stack). **With no
  sheet open the characters SHOWCASE as a full-width grid**
  (`.ecols.showcase`: the bar spans the page, `#elist` becomes an auto-fill
  grid with slightly larger portraits, `#esheets` hides); opening the first
  sheet collapses them to the side bar, closing the last rescales them
  back. The LEFT bar
  (`.epanel` → `#elist`) lists every rostered character as an `.echar` card
  with two sections (user's design, Jul 2026): a TOP grid (`.ectop`) — a
  square portrait spanning three rows, then name / element·type glyphs·level
  / weapon icon·name (`.ecname`/`.ecmeta`/`.ecwpn`) down the right — and a
  BOTTOM section of the build's FOCUSED stats in **two columns that fill
  VERTICALLY** (column-major CSS multicol, user's call). A card whose BUILD
  is DONE (frozen) gets a faint element-tinted wash (`.echar.built`,
  low-contrast `color-mix`). (`echoFocusStats`, `.ecfoc`/`.est`, gold like
  the substat highlight), valued from **`finalStats`** (base + echoes +
  weapon + forte — user's rule; finals fold `atkp`→ATK etc. via a small
  FOLD map, so ATK + ATK% focused together show ONE entry) with the
  gear-only totals as the no-base fallback, "–" for a focus with no row,
  **listed in the Final-stats panel's order** (not toggle order — user's
  rule). The focus row carries ONE condensed **`elem` chip** ("Elemental
  DMG", between Energy Regen and Basic — never six per-element chips,
  user's rule): it resolves to the character's OWN element at display time
  and only tracks on the bar (no substat rolls an element); `sanitizeBuild`
  accepts substat keys + `'elem'`. **Clicking a bar card opens that
  character's full sheet in the center panel** (`#esheets`) — **ONE build
  open at a time** (user's call): clicking another swaps to it, clicking the
  open one closes it (toggle). The open charId lives in **`state.echoOpen`
  (PERSISTED** across reloads, sanitized to a roster char or null; a
  departed char closes it), the open card dims (`.echar.open`), and the
  sheet header carries **⇤** (`data-eclose`) to close it. focus/cond/set
  pop-ups and the unequip confirm all die when `echoOpen` changes. `#echoFind`
  fuzzy-filters the BAR only (never the open sheets); it sits OUTSIDE
  `#elist` so `renderEchoList` redraws per keystroke without losing focus
  (the Teams / inventory rule). Each sheet carries `data-ec` (its charId) and
  opens with a **two-column header** (`.ehdr`, Jul 2026 rebuild) above the
  echo grid: LEFT (`.ehleft`) = the "character info" block (`.ehead`:
  portrait · name · element/type glyphs · level · the `.ehwpn` weapon link
  line) over the **Sonata set list** (`echoSetList` → `.ehsets`: one LINE
  per worn set — the set's ICON (`sonata` icon kind, `.son-ico`) + "Name
  ×count", most pieces first via `activeSets`, lit `.eset.on` when live,
  effect text only in the `setTip` tooltip; while UNSET+unlocked echoes
  remain — and the build isn't frozen — the area also carries a dashed
  **quick-fill picker** (`fillSet`, shares the icon picker, `ei==='fill'`):
  fills up to the LARGEST piece threshold that FITS the free slots — classic
  sets' thresholds are 2 and 5, so a fresh build (5 free) reaches 5pc but
  with FEWER than 5 free a classic set can only take 2 (the 2pc), leaving
  the rest for another set (user's rule); threshold sets take exactly their
  count (3 or 1) when it fits, else nothing. Slots consumed biggest-cost
  first (4→3→1), so Crown of Valor takes 4/3/1 and a following Void Thunder
  gets the leftover 3+1) and the **Conditionals block**
  (`echoCondList` → `.ehconds`): weapon passives and 5pc/threshold set
  effects are PROSE in-game, so the user transcribes each as stat + value
  (`build.conds = [{key, val, on, src}]` — NO text label, the source icon
  speaks, user's call; sanitized: canonical PERCENT key only — conditional
  values are %, NO flat stats, user's rule — positive value, ≤20 entries).
  Each is ADDED from an **icon-only ＋** (`condPlusBtn`, `.condplus`) beside
  its SOURCE — the CHARACTER (gmeta line), the linked WEAPON (`.ehwrow`), or
  a worn SET (each `.eset`); clicking opens a transient DRAFT row
  (`condDraft = {char, src}`, dies with its sheet) already showing that
  source's icon (`condSrcIco`: `'character'`→avatar, `'weapon'`→weapon,
  set-name→sonata) plus a stat select (`condStatOpts`: percent keys, the
  six elements condensed to ONE "Elemental DMG" that resolves to the
  character's OWN element on ✓) and a % input; **✓** (`data-condok`)
  commits it into a live row, **✕** cancels. A live row is an ELEGANT
  on/off toggle (`.ctog`, a styled switch — replaced the raw checkbox) +
  the source icon + "+N% Stat" + a BORDERLESS remove ✕ (`.condrm`, faint
  until hovered) — all user's calls. The whole conditional block hides
  its ＋/draft and disables the toggles/removes while the build is frozen) — a TICKED entry folds into `buildTotals`
  (and thus the finals, bar stats and goal checks; the totals sub-header
  grows "+ conditionals"), unticked ones wait; ✕ removes; the add row
  (stat select · value · label) hides and the toggles disable while the
  build is frozen;
  RIGHT (`.ehright`) = a control row (`.ehctl`: the **Focus ▾ button** with
  a chased-stat count, the `.ebudget` cost/12 chip — reddens when over, a
  WARN never a block — and the ⇤ close) over the **Final-stats panel**
  (`echoTotalsPanel`, moved up from the card bottom). Below the header, the
  wrapping 5-column `.egrid` of echoes (each: a ⠿ drag grip — plus a
  free-text name input on the LEAD echo ONLY, user's call Jul 2026 — a
  per-echo Sonata **icon PICKER** (`setPickTrigger`/`setPickPop`,
  transient `setPick = {char, ei}` — a native `<select>` can't show icons
  and 34 lookalike names confuse, user's call; the trigger shows the chosen
  set's icon+name, clicking opens a scrollable icon+name list), a compact
  cost select — just the number — LEFT of the main-stat select, its derived
  value + secondary, and five substat rows). Every control live-applies via `bindEchoSheet`
  (per-card, resolving the charId from the enclosing `.ebuild`) →
  `ensureBuild` → `save(); render()`; substats are re-read from the card
  densified (`readEchoSubs` drops empty rows, snaps values). The echo NAME
  input saves on each keystroke WITHOUT re-rendering (caret safety, like
  the filter inputs). **Focus stats** (`build.focus`, an ORDERED list of
  substat keys + `'elem'`): managed in the **Focus pop-up** (`focusPopup`,
  `.fpop`, anchored under the ▾ button; open state = transient `focusPop`
  charId, survives re-renders, dies with its sheet) — the chased stats as
  numbered rows with ▲▼/✕ and the rest as `.fochip` add-chips that append
  (click-to-add + ▲▼, user's call; `focusableKeys()` inserts `elem` between
  `er` and `basic`). **The focus ORDER sorts each echo's substat display**
  (`sortSubsView`: focused first in focus order, unfocused after in
  canonical order, empties trail; `data-si` = display index, and
  `readEchoSubs` re-reads display order so storage follows — harmless, subs
  are a set). It applies ONLY there — the Final-stats panel and bar cards
  keep their own order (user's call). Assigning a focused stat makes its
  row HOP to its sorted slot; the `[data-esub]` change handler then
  re-focuses that row's VALUE select so Tab keeps flowing (user's rule).
  A focused substat is highlighted gold (`.esub.focus`) where it lands;
  mains are deliberately not highlighted (user's call). `sanitizeBuild`
  keeps only substat keys + `'elem'`, de-duped, order preserved.
  **Stat goals** (`build.goals = {key: n}` — focusable keys, positive
  finite numbers, stated in FINAL terms: "65" on Crit Rate means final 65%,
  an ATK-line goal is a flat final ATK): set per chased stat in the Focus
  pop-up's "≥ __" input (empty/0 clears). On the Final-stats grid a goal'd
  row reads "value / goal" in the NEUTRAL tone while short (`.etv.short`,
  faint `.goalp` tail, gap in the tooltip) and JUST the value in the GOLD
  tone once reached (`.etv.met` — the goal retires to the tooltip; unmet
  and unset stay neutral; all user's calls). A goal'd stat with no finals
  row still renders a line at 0; a goal SURVIVES unfocusing (dormant in the
  map, `goalFor` matches through `finKeyOf`/`FOCUS_FOLD`); the BAR cards
  follow the same logic — an ACHIEVED stat's value reads ochre
  (`.est b.met`), unmet/unset neutral ink (user's call); the gear-only
  fallback shows "value / goal" unjudged. A FOCUSED stat's NAME is bold on
  the grid (`.etk.foc`, halfway mut→ink — contrast tuned to the user's
  taste), same for the gear fallback.
  **⇅ Stat priority** (`state.statPrio`, top-level save field, null =
  canonical order): the Echoes section header's static button + pop-up
  (`prioPopup`/`bindPrioPop` into `#prioPopSlot`, transient `prioPop`)
  ranks ALL focusable stats with ▲▼ (+ ↺ reset to null);
  `statPrioList()` keeps a partial ranking's order and trails unlisted
  keys canonically. The template ONLY decides where a newly FOCUSED stat
  slots into a character's list (`[data-fadd]` inserts at template rank;
  plain append while unset) and orders the add-chips — an existing
  per-character order is never re-sorted (user's rule: most characters
  share one formula, so rank once, tweak per character).
  **Frozen (completed) builds** (`build.frozen`, persisted; sanitize keeps
  the flag as-is — it is the user's word, never re-derived): when EVERY
  goal is met (`allGoalsMet` — needs ≥1 goal and finals on file) the sheet's
  control row offers **✓ Complete**; clicking freezes the build — every
  gear control renders `disabled`, grips inert, the weapon line stops
  linking, the grid dims (`.ebuild.frozen .egrid`), and the Focus pop-up
  leaves ONLY the "≥" goal inputs live (add/reorder/remove disabled). The
  button becomes **✎ Edit**, which thaws everything; raising a goal past
  the build does NOT unfreeze it. **Per-echo locks** (`echo.lock`,
  persisted via sanitizeBuild): each echo column's flat SVG padlock
  (`LOCK_ICO`/`UNLOCK_ICO`, `.elock` pinned right of the header — user's
  calls) toggles that one echo read-only with a gold-tinted background
  (`.ecol.locked`); lock buttons themselves freeze with the build.
  **Bar order**: OPEN characters float to the TOP of the bar (stable within
  groups, like the Teams energy sort). **Bar filter chips**
  (`#echoChipRow`, `.echips`, transient `echoChips` — palette semantics:
  rarity 5/4 · six elements · five weapon types; within a facet OR, across
  facets AND, ✕ clears) narrow the bar alongside the fuzzy box. A build
  materializes only on the first edit; `echoFilter` is transient (a reload
  starts empty). Echo
  data (5★ +25) verified Jul 2026 vs Game8 / wutheringwaves.gg / Wuthering
  Insight; softer-verified: the Energy-Regen substat ladder, flat ATK/DEF
  tiers, and Sun-sinking Eclipse's identity (re-check at a phase-2 pass).
- **Save format** lives in localStorage key `wuwa-planner-v1`. `sanitize()`
  migrates all older generations (v1 counts → v2 `{minor,major,inh}` arrays →
  current matrix) and repairs illegal states. Later-added top-level fields:
  `done` (completed goals), `hideUn` (legacy — the Hide-un-needed filter it
  drove is gone; still sanitized so old saves don't error), `skipCE`
  ("Ignore credits & EXP"), `teams` (Teams page), `week`
  (`{start, used}` — weekly-boss claims spent this game week), `wkPlan`
  (the weekly planner's drag-reordered claim sequence: an array of
  Weekly-Boss material ids, one per claim; null/absent = queue order;
  sanitize keeps only real weekly ids and collapses junk to null), `craftMode`
  (`'reserve'|'priority'`, anything else sanitizes to `'reserve'`), the
  per-goal `off` (paused) and, on weapon goals, `owner` (the character who
  carries it), plus `builds` (the Echoes page — a `{charId: build}` map, kept
  only for roster characters; each build carries `focus`, `goals`, `echoes`)
  and `statPrio` (the Echoes page's global stat-priority template — an
  ordered focusable-key list, null = canonical) — all default safely when
  absent. A team's old custom `name` is
  DROPPED on load (teams are auto-named after their first member now). A saved
  `tab:'left'` (the removed Inventory tab)
  migrates to Total. Never break old-save loading; add migrations instead.
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
weapon:'weapons/', attr:'attributes/', sonata:'sonata/'}, exts:['png','webp','jpg'],
overrides:{}}` — kind subfolder is picked by what the icon is for. The `attr`
kind holds the game's **element and weapon-type glyphs** (6 + 5, one flat
folder — the vocabularies don't collide), fetched from the wiki's
`File:<Name> Icon.png` by `fetch-icons.js`; the card meta lines show these
instead of the words. The `sonata` kind holds the 34 **Sonata set icons**
(Echoes page: header set lines + beside each echo's set select) — wiki files
are the PREFIX form `File:Icon <Name>.png`, unlike the glyphs' suffix form;
all 34 fetched Jul 2026. Slug rule: lowercase display name, drop
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
are no automated screenshot tests — jsdom asserts DOM/wiring, never pixels.

**Visual check (WSL only):** the repo sits on the Windows C: drive and the
host has Chrome, so headless Chrome can render a real screenshot the agent
can view. Static page:
`"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new
--disable-gpu --hide-scrollbars --user-data-dir="C:\Temp\cshot"
--virtual-time-budget=3000 --window-size=1500,1700
--screenshot="C:\dev\projects\wuwa_tracker\shot.png"
"file:///C:/dev/projects/wuwa_tracker/wuwa-planner.html"` — local `images/`
resolve over `file://`. For an INTERACTIVE state, copy the HTML to a temp
file IN THE PROJECT DIR (so `images/` still resolve) and append a `<script>`
that drives it — top-level `let`s (`editIdx`, `showTip`, `state`…) are
shared across classic scripts, e.g. `editIdx = 0; renderModal();` for the
editor or `showTip(document.querySelector('#summary .tile'))` for the hover
popover. `shot*.png` and `_shottmp.html` are gitignored. This is a manual
visual aid, not a test — still be careful with CSS-only changes.

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
  display name — data attributes must not carry ids).
- **Hover popover** (`#tipPop`, `showTip`/`hideTip`): hovering any `.tile`
  opens a small floating card (position:fixed, z-index 80, pointer-events
  none). Header names the material and its progress; below it the needers as
  **avatar chips** (`.tip-chip` with an `icoImg` face, char or weapon folder
  by `kind`), each showing **that goal's** progress. Progress (`progress()`,
  used for both) reads: owning **none → just the amount needed** ("6", never
  "0/6"), **part way → own/needed** ("4/6"), **covered → ✓**
  (`.tip-chip.ok`). `own` comes from
  `buildNeeders`, which walks `farmNextWalk`, so the popover uses the SAME
  queue-order allocation as the goal cards (P1 eats the stock first) — it must
  never invent a different one. Native `title` can't carry images. While it's
  up the tile's own `title`
  is stashed (`tipTitle`) and removed so the browser doesn't also pop its
  default tooltip; `hideTip` (on mouseleave, and at the top of `render()`
  for stale-popover cleanup) restores it. Only ONE tile is hovered at a
  time (`tipTile`). The click handler reads the stashed title when the
  clicked tile is the hovered one. Scoped to `.tile` (cards, Total, Farm
  next) plus the weekly planner's claim cells — the popover plumbing is
  `showPop(el, html)` (position + title-stash), which `showTip` (tiles,
  NEEDERS-derived) and the planner (per-claim `WKTIPS[ci]`, taker chips
  ×share, built in `weeklyBox`) both feed; the inventory pop-up grid
  (`.itile`) keeps plain name `title`s.
  **exp/wexp tiles show a top-tier item count, not raw EXP** (`expTopTier`/
  `wexpTopTier`, pure/engine: ceil ÷ 20k — "366", not "7.31M"; `tileQty`
  routes it), and the registry marks exp/wexp `r:5` so the ground matches
  the Premium potion/core icon the tile carries; exact EXP stays in the
  tooltip. **There is no Inventory tab** — resource management is the
  Inventory pop-up (see below); old saves with `tab:'left'` migrate to Total
  in `sanitize`.
- **Tiles show the deficit after inventory** (`deficitTiles`): goal cards
  allocate the pool in queue order (renderGoals runs `farmNextWalk`, so the
  first card that needs a material eats the stock and later cards see the
  leftovers — same rule as the Farm next tab). With the synthesis toggle
  on, the walk also CRAFTS (`farmNextWalk(goals, inv, craft, mode)` → pure
  `craftFromPool`): each goal may cover family-tier deficits 3→1 from pool
  surplus. **Two rules, picked by `state.craftMode`** (`craftMode()` in the
  UI reads it defensively; the `.cmode` select sits beside the Craft 3→1
  checkbox on the Total tab and only renders while crafting is ON):
  `'reserve'` (default, cautious) builds a `reserve` map holding every
  quantity any queued goal still needs directly at each tier — those are
  never crafted away ("have 22, need 10 → only 12 craft", user's rule);
  `'priority'` (greedy) skips the reserve entirely, so the top goal crafts
  from every lower tier it can reach and finishes as early as possible and
  later goals get what survives. The rules only diverge under contention
  within one family; with crafting off `mode` is inert. Chains (9× t0 → 1×
  t2) consume exactly, wasting nothing on a short chain; low-tier deficits
  craft before high. The Total tab nets the aggregate via `remainingBag`
  (synthesis-aware; order-free, so `craftMode` doesn't apply there). Covered
  mats stay visible as a dimmed ✓ (`.tile.done`), with the full requirement
  in the tooltip.
- **Cards are read-only status views**: a header row (`.goal-top`: prio ·
  avatar · name (grows, ellipsis + title — 5 buttons leave it little room) ·
  `.gctrl` buttons ✎▲▼⏸✕ in that order, with ✓ prepended on a finished goal)
  with the meta on its OWN full-width row below (`.goal .gmeta`) so the level
  range never wraps in a narrow 3-col card. The priority number is BARE ("1",
  not "P1" — the reorder pop-up still prefixes P). **The meta row reads as the
  goal's identity, glyphs not words** (`attrIco`, kind `attr`):
  character = `5★ [element] [weapon type] · Lv 1 → Lv 90`;
  weapon = `[carrier] 5★ [weapon type] · Lv 1 → Lv 90`. Rarity is plain
  rarity-colored text (`rStar`) — the avatar carries no ring (tried, user
  rejected it, Jul 2026). Level text is `lvlLabel(g)`: "Lv 1 → Lv 90" while
  building, just "Lv 90" once `cur.ord === tgt.ord` (no "Lv 90 → Lv 90").
  Then a mini forte tree (`miniTree`,
  span-based, no handlers) with per-column skill levels cur→tgt + an
  always-visible materials tile grid (`goalMats`). All editing happens in the ✎
  pop-up (`#modalWrap`/`renderModal`): level row plus a game-view forte grid
  where each skill column stacks its two nodes above its level selects.
  Live apply — modal controls reuse `onField`/`onNode`, which save+render;
  `render()` re-renders the open modal in place. `editIdx` is transient
  (never persisted); Esc/backdrop/✕ close; deleting the edited goal closes.
  `goal.open` still exists in saves but is legacy/unused.
- **Upgrade transactions** (goal editor, below the Max buttons — never in
  template mode): grouped into horizontal TRACKS in preview order — Level, then
  Forte nodes (one track), then each skill — each with a **+1** and a **Max**
  button (`.trk`, indexed by `UPG_TRACKS`). +1 buys the next single step; Max
  buys as far as the FULL stock affords in sequence and NAMES the level it
  reaches ("Max → Lv 80" when partial, "→ +N nodes" for the node track). A
  track's `steps` are ordered incremental costs (`costForGoal` between adjacent
  states); the Forte-nodes track orders lowers before uppers so a Max run buys
  in dependency order (Ⅱ lands owned only because Ⅰ precedes it). The pure engine
  `affordableRun(inv, costs, craft)` settles the ordered costs against a scratch
  inv and returns how many are affordable; the click then spends+applies exactly
  that many, one step at a time, in a single `withUndo` (misclick = one Ctrl+Z). Affordability checks the user's **FULL stock —
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
- Rendering is "state changes → full re-render" via `render()`. Event
  handlers bind after each render; data attributes carry indices, never
  material ids (apostrophes in names).
- **Inventory pop-up** (`#invWrap`, toolbar "☷ Inventory" or Ctrl/Cmd+I):
  the ONLY resource-management surface — a pure "what I have" list, every
  registry item as a rarity tile (icon + quantity input, **name-only** hover
  title) in category sections. NO deficit info lives here — no need/left, no
  "covered" dimming, no Craft-3→1 or Hide-un-needed toggles — because that's
  shown across the rest of the UI (cards, Total, Farm next). Within a
  category, tiles follow the game's inventory order: **rarity bands
  DESCENDING** (all top-tier first, then the next…), and inside a band the
  **definition order** (`Object.keys(MATS)` — the order materials are DEFINED
  in the data), which runs oldest → newest (families in release order). The
  code relies on `Array#sort` being STABLE: it filters in registration order,
  then sorts by rarity only, so the definition order survives inside each
  band. Never add a name/family tiebreak — that scrambles it (the old
  alphabetical sort did, and `sortMatIds` still does for the planning views).
  `IGRID` carries ids by index. The grid
  builds once per open and is NOT re-rendered on input (focus safety);
  CLOSING it (Esc/backdrop/✕, priority palette → reorder → inventory →
  editor; Ctrl+K/P close it too) runs the full `render()`, the "apply
  everywhere when done" step. Writes go through the shared `setStock`.
  A **fuzzy filter box** (`#invFind`, transient `invFilter`, reuses
  `fuzzyScore` — so "lfhow" finds LF Howler Core) is the way in: `openInv()`
  focuses it, and it rebuilds the grid per keystroke *safely* because the
  input sits in the header OUTSIDE `#invGrid`. Enter on a lone match jumps
  into its quantity input; `openInv`/`closeInv` clear the filter. Tiles here
  are **inert** — no click handler, no steppers: this grid is a typing
  surface, and per-family nudging belongs to the farm pop-up.
- **Farm pop-up** (`#farmWrap`, `openFarm(id)`): the after-a-run surface.
  Opened by clicking any material icon on the Ledger page (goal-card tiles,
  Total, Farm next) and layered above every other pop-up (z-index 55; Esc
  order is palette → reorder → **farm** → inventory → editor).
  It shows ONLY the clicked material's family — `familyIds` (pure/engine):
  a family's four tiers low→high, the potion or core ladder for anything in
  an EXP pool, otherwise the material alone (boss/specialty/weekly/credits
  are singletons). `famLabel` (pure/engine) titles it with the words the
  tiers share at one end — a suffix for "LF/MF/HF/FF Howler Core", a prefix
  for "Waveworn Residue 210/226/…"; a singleton labels itself. Styled to
  MATCH the inventory pop-up (`.ftile` mirrors `.itile`: icon + quantity
  input, name on hover), with **`+1`/`+5`** steppers beneath each tile
  (`.fstep`, Shift-click subtracts, clamped at zero). Like the inventory it
  carries NO need/left — just quantities. Writes go through the one shared
  `setStock(id, v, inp)` (strips zeros); CLOSING runs the full `render()`,
  the same "apply everywhere when done" rule. `FARM` carries ids by index.
- Reordering: the **goal cards are NOT draggable** — reorder with the ▲▼
  buttons on each card (work on touch), which route through `moveGoal(from,
  to)` (`to` = pre-removal insertion index). Bulk drag lives only in the
  **reorder pop-up** (`#ordWrap`, toolbar "⇅ Reorder" or Ctrl/Cmd+P —
  preventDefault suppresses browser print): a compact vertical list where
  whole rows drag (`ordDrag` module variable) plus per-row ▲▼; live apply
  through the same `moveGoal`, and `render()` re-renders the open list via
  `renderOrder()` (no-op when closed). Ctrl+K/`openPal` closes it; Esc
  priority is palette → reorder → editor. (The old card `dragIdx`/`bindDnD`
  HTML5 DnD is gone; `.grip` CSS now serves the pop-up rows only.)
- Summary tabs (three now — Inventory tab removed): Total (aggregate deficit
  + waveplate line + the two global toggles: "Ignore credits & EXP" and
  "Craft 3→1", the latter `#synthChk` moved here from the old tab, plus the
  `#craftMode` rule select that appears next to it while it's on; all
  `save(); render()`. The tab counts only ACTIVE goals and says how many
  paused ones it left out; every-goal-paused is its own empty state) /
  Farm next (see below) / Completed (finished goals; tab label carries a
  count when non-empty).
- **Farm next** is organized BY ACTIVITY, top to bottom: the **weekly-boss
  planner** (below) — which leads the tab only WHILE a weekly claim is still
  available this week; once all 3 are spent it renders at the BOTTOM instead
  (nothing actionable up top; Monday's reset floats it back — user's rule) —
  then one `.freefarm` box per waveplate activity —
  **Boss materials / Forgery materials / Simulations** (`actBox`: the same
  `deficitTiles` as the Total tab, covered mats keep their dimmed ✓, ordered
  by queue priority, flat — no per-boss/domain sub-headers, material names
  are enough, user call Jul 2026; a box only renders while something in it
  is still missing; the Simulations box respects `skipCE`), and finally the
  **"No waveplates needed"** box listing every still-missing free material —
  Specialty pickups and common Enemy Drops — grouped by category (`.ffcat`)
  like the Inventory pop-up. `overworldBag(bag)` (pure/engine) does that
  filtering; an engine test locks its key set to
  `waveplateEstimate(bag).overworld` so the two can't drift. The old
  per-goal walk rows and the old "Today's 240⚡" box (`dailyPlan`/`todayBox`)
  are GONE (user call, Jul 2026) — boss/forgery/sim yields are crowdsourced
  averages, so a multi-day schedule was never honest; the tiles still open
  the farm pop-up to log real drops (an EXP tile opens the potion ladder —
  the only way a sim's yield can be logged, since `state.inv` has no raw-EXP
  slot).
- **Weekly-boss planner** (`weeklyPlan(bags, weeklyUsed, startMs, order)`,
  pure/engine; `weeklyBox` renders it at the top of Farm next): lays EVERY
  remaining weekly-boss claim into game weeks — one `.wkrow` per week
  ("This week", then Monday dates), three `.wkcell` slots each. Weeklies are
  the one DETERMINISTIC drop (always `weekly.drops` = 3 per claim), which is
  what makes the multi-week forecast honest. Internally the plan is a FLAT
  claim sequence (`{id, goal}` per claim; `WKSEQ` in the UI, cells carry
  `data-ci` indices — never material ids); weeks merely paginate it (the
  current week holds `3 − week.used` slots, spent claims show as dimmed ✓,
  leftover slots as dashed free cells), so moving a claim ripples the
  displaced one into the next week with no special cases. Claims default to
  queue order with the wk: merge (a shared weekly's partial-claim spare
  carries to the later goal); each claim's needer avatar comes from a
  slot rule — the k-th claim of a boss covers mats [3k, 3k+3) of the
  queue-ordered demand — so chips stay honest under any reordering. The
  header counts claims and names the finish week ("done this week" when it
  all fits in the current one). Cells show **×take — what the claim actually
  COVERS**, not what it drops: only a boss's LAST claim can be partial
  (total demand not divisible by 3; gold-tinted `.x.part`, tooltip says the
  claim still drops 3, ✓ still credits 3). A claim straddling a goal
  boundary is NOT surplus — its leftover mats serve the next hero needing
  that boss (user's rule), and the cell's `split` names both takers in the
  tooltip ("2 for Jinhsi, 1 for Phoebe") and as avatar chips in the hover
  popover (`WKTIPS`, via the shared `showPop`). Only the genuine overshoot
  per boss lands in `plan.spare`, footed under the rows as **icon tiles**
  (`.wk-spare`, qty "+n" — no text, user's call; the "name — " title prefix
  keeps them on the shared tile hover/click pipeline).
  - **Drag to reorder** (`moveClaim`, moveGoal splice semantics; drop on a
    cell inserts before it, on a free tail slot appends): the manual order
    persists as **`state.wkPlan`** (ordered weekly-mat ids, one per claim;
    null = queue order). `weeklyPlan` reconciles it every render — entries
    kept while that boss still needs claims, stale extras dropped, new
    claims appended in queue order (claims of one boss are interchangeable,
    so only the ORDER matters). A "↺ queue order" button clears it.
    **Dragging a week's DATE label moves that whole week's claims as one
    block** (`moveWeek`; `WKROWS` maps rows to seq slices; drop anywhere on
    a target row, block lands before its claims — insert-before, like
    cells; a week-drag and a cell-drag carry separate state, `wkRowDrag`
    vs `wkDrag`, so a drop only answers its own kind).
  - **Right-click ✓-claims** — CURRENT week only (`.wkcell.cur`): credits
    exactly 3 mats, spends one weekly claim, wrapped in `withUndo`. With a
    manual order in place the handler removes exactly the clicked claim
    from `wkPlan` (reconciliation alone would trim that boss's LAST
    occurrence and quietly reshuffle a deliberate interleave).
  - **Left-click** opens the farm pop-up on the boss material, like every
    other tile. Both power gestures are documented in the ⌨ cheat sheet's
    "Weekly planner" group.
- **The game week** (`state.week = {start, used}`, `weekStartMs(nowMs)` in the
  engine — pure, takes the clock as an argument so tests can pin it): `start`
  is the most recent **Monday 04:00 LOCAL** boundary and identifies the week;
  `sanitizeWeek` resets `used` to 0 whenever the stored week isn't the current
  one — that IS the weekly reset (the user's system clock is assumed to track
  their server region, user-confirmed). `used` shrinks the planner's current
  row (`weeklyPlan(bags, weeklyUsed, …)`), so an exhausted week shows three
  spent slots and pushes every claim a week out; successive week starts use
  set-date arithmetic (`addWeeksMs`) so the boundary survives DST. Farm next
  shows "Weekly claims N/3 left this week".
- **"Ignore credits & EXP"** (`state.skipCE`, checkbox on the Total tab):
  a VIEW-level filter — `stripCE(bag)` (pure/engine) drops `credits`/`exp`/
  `wexp` before tiles, readiness bars, waveplate estimates, the Total
  aggregate, and Farm next's missing lists + READY flags. It never touches
  the truth: `costForGoal` output and the finished/✓-mark check (a goal
  needing only credits can't be marked complete by the toggle — cards say
  "Only credits & EXP left — ignored").
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
   Firstlight's Herald's exoswarm enemy family and drop its `beta:true` —
   that is now the ONLY open item there. The ten stopgap icons were swapped
   for proper wiki files on 2026-07-14: `node fetch-icons.js` reports
   `0 fetched, 0 not found` and `images/missing_icons.md` records the
   gotcha (the wiki kept the beta prefix form for the kernels, so the
   fetcher carries a `TITLE_OVERRIDES` map: display name → wiki file title).
   (Icon source of record: fandom wiki files `Item/Resonator/Weapon
   <Name>.png` and `<Name> Icon.png` for the element/weapon-type glyphs, via
   the MediaWiki API — page fetches are Cloudflare-blocked but the API and
   static.wikia CDN are not; payloads are WebP saved as .png; '#' and ':'
   are dropped from file names.) The 2026-07-10 launch checkpoint is done —
   see the provenance section. Note: the Dimbreath/WutheringData datamine
   is abandoned at 3.1.0 — verify post-3.1 data via Game8/prydwen instead.
2. **Echoes page — phase 2 (partly done):** the gear-stat MVP shipped Jul 2026,
   then **final numbers** (base char + linked weapon folded with gear →
   `finalStats`; `GAME.charBase`/`GAME.weaponBase`, verified vs Game8/wuthering.gg)
   — see the Echoes-page bullet. Stat GOALS ("CR 65%+" against the finals)
   and the global stat-priority template shipped Jul 2026. Still open, all
   additive on the same canonical vocabulary: base stats for the 4 unreleased
   5★ (lucy, rebecca, lucilla, suisui — held back, no verified base yet);
   5pc Sonata effect text; cost TEMPLATES (43311/44111) as a fill
   convenience. Softer-verified data to re-check: Energy-Regen substat
   ladder, flat ATK/DEF tiers, Sun-sinking Eclipse's identity, Firstlight's
   Herald weapon base (beta, med confidence), and the med-confidence single-source
   char bases (augusta, iuno, galbrena, qiuyuan, mornye, lynae, luukHerssen).
3. Backlog (user-approved ideas, unscheduled): `iconSlug` duplicated between
   the app and `fetch-icons.js`, legacy unused `goal.open`. **Not doing:** Echo
   XP / tuners (user declined, Jul 2026). No farming-schedule/day-of-week
   features — WuWa domains are always open (user-confirmed). "Buy all affordable
   steps" (the upgrade tracks) and per-block test isolation via `reset()` are
   both DONE.

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