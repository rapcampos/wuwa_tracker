// Test harness: evals the planner's <script> blocks (no DOM needed) and
// validates the engine against independently known totals.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'wuwa-planner.html'), 'utf8');
// blocks 0–1 are data + engine (pure); block 2 is the DOM-bound UI layer
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).slice(0, 2);
eval(blocks.join('\n;\n') + `
;Object.assign(globalThis, {GAME, MATS, MILES, ORD_LEVEL, ORD_LABEL, CATEGORY_ORDER,
  costForGoal, totalBag, freshState, maxedState, expToPotions, remainingBag, farmNextWalk, sortMatIds,
  freshWpnState, maxedWpnState, wexpToCores, fmtShort, priorityMatIds, defaultGoalTgt, fuzzyScore,
  nodeShortfall, charEnergy, teamUsage, energyLeft, sanitizeTeams, expTopTier, wexpTopTier,
  waveplateEstimate, stripCE, craftFromPool, affordCost, poolPlan, spendCost, dailyPlan, familyIds, famLabel,
  statNodesFor, forteStatTotals, overworldBag, isOverworld});`);

let pass = 0, fail = 0;
const canon = v => (v && typeof v === 'object' && !Array.isArray(v))
  ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a < b ? -1 : 1).map(([k,x]) => [k, canon(x)]))
  : v;
const eq = (label, got, want) => {
  const ok = JSON.stringify(canon(got)) === JSON.stringify(canon(want));
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
};

// ═══ 1. FULL BUILD: Lv1→90, all forte 10, both inherents, all 8 nodes ═══
// Known totals (wiki + Game8 + datamine cross-check):
//   boss 46 · specialty 60 · weekly 26 · forge 25/28/55/67 · commons 29/40/52/61
//   credits 3,053,300 (170k asc + 2,030k forte + 853.3k leveling) · EXP 2,438,000
// sanhua (4★) and augusta (2.x tidal/waveworn) prove the template is shared
// across rarities and eras — datamine-verified, all resonators cost the same
for(const cid of ['jinhsi','phoebe','suisui','sanhua','augusta','lucilla']){
  const ch = GAME.characters[cid];
  const bag = costForGoal({char:cid, cur:freshState(), tgt:maxedState()});
  eq(`${cid} full: boss`,    bag['boss:'+ch.boss], 46);
  eq(`${cid} full: spec`,    bag['spec:'+ch.spec], 60);
  eq(`${cid} full: weekly`,  bag['wk:'+ch.weekly], 26);
  eq(`${cid} full: forge`,   [0,1,2,3].map(t=>bag[ch.forge+t]),  [25,28,55,67]);
  eq(`${cid} full: commons`, [0,1,2,3].map(t=>bag[ch.common+t]), [29,40,52,61]);
  eq(`${cid} full: credits`, bag.credits, 3053300);
  eq(`${cid} full: exp`,     bag.exp, 2438000);
}

// ═══ 2. PARTIAL LEVEL RANGE: Lv50✦ (ord 6) → Lv80 unascended (ord 11) ═══
// EXP 1,669,100−397,100 = 1,272,000; ranks 4 & 5 crossed:
// boss 9+12=21, spec 12+16=28, commons T3 4+8=12,
// credits 60,000 + round(1,272,000×0.35)=445,200 → 505,200
{
  const cur = {...freshState(), ord:6}, tgt = {...freshState(), ord:11};
  const bag = costForGoal({char:'jinhsi', cur, tgt});
  const ch = GAME.characters.jinhsi;
  eq('50✦→80: exp', bag.exp, 1272000);
  eq('50✦→80: boss', bag['boss:'+ch.boss], 21);
  eq('50✦→80: spec', bag['spec:'+ch.spec], 28);
  eq('50✦→80: commons', [bag[ch.common+0], bag[ch.common+1], bag[ch.common+2], bag[ch.common+3]],
     [undefined, undefined, 12, undefined]);
  eq('50✦→80: credits', bag.credits, 505200);
}

// ═══ 3. SINGLE ASCENSION: Lv20 (ord 1) → Lv20✦ (ord 2), rank 1 only ═══
{
  const cur = {...freshState(), ord:1}, tgt = {...freshState(), ord:2};
  const bag = costForGoal({char:'phoebe', cur, tgt});
  eq('20→20✦: bag', bag, {credits:5000, whisperin0:4});
}

// ═══ 4. SKILL 6→8 on one node: L7 (f T3×5, c T3×3, w1, 30k) + L8 (f T4×2, c T4×2, w1, 50k) ═══
{
  const cur = freshState(); cur.skills = [6,1,1,1,1];
  const tgt = freshState(); tgt.skills = [8,1,1,1,1];
  const bag = costForGoal({char:'suisui', cur, tgt});
  eq('skill 6→8: bag', bag,
     {credits:80000, strings2:5, kernel2:3, 'wk:Skyward Glazed Heart':2, strings3:2, kernel3:2});
}

// ═══ 5. NODES & INHERENTS ONLY ═══
{
  const cur = freshState();
  const tgt = {...freshState(), inh1:1, inh2:1, minor:4, major:4};
  const bag = costForGoal({char:'jinhsi', cur, tgt});
  // inh1: f T2×3 c T2×3 w1 10k · inh2: f T3×3 c T3×3 w1 20k
  // minor ×4: f T3×3 c T3×3 50k · major ×4: f T4×3 c T4×3 w1 100k
  eq('nodes: credits', bag.credits, 10000 + 20000 + 4*50000 + 4*100000);
  eq('nodes: forge tiers', [0,1,2,3].map(t=>bag['waveworn'+t]), [undefined, 3, 3+12, 12]);
  eq('nodes: common tiers', [0,1,2,3].map(t=>bag['howler'+t]),  [undefined, 3, 3+12, 12]);
  eq('nodes: weekly', bag["wk:Sentinel's Dagger"], 1+1+4);
  // (an "Inherent Ⅱ without Ⅰ" state is invalid in-game; the UI grid enforces
  //  the ordering, so the engine never receives it)
}

// ═══ 5b. ROVER EXCEPTIONS: Mysterious Code ×5, Aero's split common family ═══
{
  const bag = costForGoal({char:'roverAero', cur:freshState(), tgt:maxedState()});
  eq('rover: Mysterious Code ×1 at ranks 2-6', bag['boss:Mysterious Code'], 5);
  eq('rover aero: ascension commons (whisperin 4/12/12/4)',
     [0,1,2,3].map(t=>bag['whisperin'+t]), [4,12,12,4]);
  eq('rover aero: forte commons (tidal 25/28/40/57)',
     [0,1,2,3].map(t=>bag['tidal'+t]), [25,28,40,57]);
  eq('rover: spec/weekly/credits follow the template',
     [bag['spec:Pecok Flower'], bag['wk:When Irises Bloom'], bag.credits], [60, 26, 3053300]);
  // non-Aero Rovers keep one family for both ascension and forte
  const rs = costForGoal({char:'roverSpectro', cur:freshState(), tgt:maxedState()});
  eq('rover spectro: unified commons (29/40/52/61)',
     [0,1,2,3].map(t=>rs['whisperin'+t]), [29,40,52,61]);
}

// ═══ 6. EXP → POTIONS: exact greedy with minimal overflow ═══
eq('potions 1,272,000', expToPotions(1272000), {exp4:63, exp3:1, exp2:1, exp1:1});
eq('potions 0', expToPotions(0), {});
eq('potions 500 (rounds up)', expToPotions(500), {exp1:1});

// top-tier equivalents (tile display): ceil(exp / 20,000), never negative
eq('top-tier: full 5★ char build', expTopTier(2438000), 122);
eq('top-tier: full 5★ weapon build', wexpTopTier(2692400), 135);
eq('top-tier: partial rounds up', [expTopTier(1), expTopTier(20000), expTopTier(20001)], [1, 1, 2]);
eq('top-tier: zero and negative are 0', [expTopTier(0), wexpTopTier(-5)], [0, 0]);

// ═══ 7. SYNTHESIS: surplus crafts 3→1 upward ═══
{
  // need 2× T4 howler, own 7 spare T3 → craft 2, deficit clears
  const need = {howler3: 2};
  const r1 = remainingBag(need, {howler2: 7}, true);
  eq('synth on: T3 surplus covers T4', r1.rem, {});
  const r2 = remainingBag(need, {howler2: 7}, false);
  eq('synth off: deficit stays', r2.rem, {howler3: 2});
  // chain: 9× T1 → 3× T2 → 1× T3
  const r3 = remainingBag({howler2: 1}, {howler0: 9}, true);
  eq('synth chain T1→T3', r3.rem, {});
  // surplus below need must never craft away needed mats
  const r4 = remainingBag({howler0: 4, howler1: 1}, {howler0: 4}, true);
  eq('synth never eats needed mats', r4.rem, {howler1: 1});
}

// ═══ 8. INVENTORY & EXP POOL ═══
{
  const need = costForGoal({char:'jinhsi', cur:freshState(), tgt:maxedState()});
  const inv = {'boss:Elegy Tacet Core': 50, exp4: 100, exp1: 5, credits: 3000000};
  const r = remainingBag(need, inv, false);
  eq('inv: boss covered', r.rem['boss:Elegy Tacet Core'], undefined);
  eq('inv: credits partial', r.rem.credits, 53300);
  eq('inv: exp partial', r.rem.exp, 2438000 - (100*20000 + 5*1000));
  eq('inv: potion plan for remainder', r.potionPlan, expToPotions(433000));
}

// ═══ 9. FARM-NEXT WALK: priority order consumes the pool sequentially ═══
{
  const g1 = {char:'jinhsi', cur:{...freshState(), ord:1}, tgt:{...freshState(), ord:2}}; // needs 4 howler0 + 5k
  const g2 = {char:'phoebe', cur:{...freshState(), ord:1}, tgt:{...freshState(), ord:2}}; // needs 4 whisperin0 + 5k
  const walk = farmNextWalk([g1, g2], {howler0: 4, whisperin0: 4, credits: 5000});
  eq('walk: goal 1 ready', walk[0].ready, true);
  eq('walk: goal 2 blocked on credits only', walk[1].rem, {credits: 5000});
  // same two goals, shared-material contention
  const g3 = {char:'jinhsi', cur:{...freshState(), ord:1}, tgt:{...freshState(), ord:2}};
  const walk2 = farmNextWalk([g3, {...g3, char:'jinhsi'}], {howler0: 6, credits: 99999});
  eq('walk: pool depletes in order', walk2.map(w => w.rem),
     [{}, {howler0: 2}]);
}

// ═══ 9b. WALK WITH CRAFTING: synth per goal, needed lower tiers protected ═══
{
  // the user's rule: 22 held, 10 must stay → only the 12 surplus crafts (4× next tier)
  const pool = {carved2: 22};
  eq('craft: surplus above the kept amount crafts up', craftFromPool(pool, {carved2: 10}, 'carved', 3, 4), 4);
  eq('craft: the kept amount is untouched', pool.carved2, 10);
  const pool2 = {howler0: 9};
  eq('craft: chains 3→1 across tiers (9× t0 → 1× t2)', craftFromPool(pool2, {}, 'howler', 2, 1), 1);
  eq('craft: chain consumed exactly', pool2.howler0, 0);
  const pool3 = {howler0: 8};
  eq('craft: a short chain wastes nothing', [craftFromPool(pool3, {}, 'howler', 2, 1), pool3.howler0], [0, 8]);
  const pool4 = {howler1: 2, howler0: 3};
  eq('craft: mixed-tier chain tops up from below', [craftFromPool(pool4, {}, 'howler', 2, 1), pool4.howler1, pool4.howler0],
     [1, 0, 0]);

  // walk integration: goal 1 (50✦→80) needs 12× howler2; goal 2 still needs
  // 3× howler1 directly — goal 1's crafting must leave those 3 alone
  const gA = {char:'jinhsi', cur:{...freshState(), ord:6}, tgt:{...freshState(), ord:11}};
  const gB = {char:'jinhsi', cur:freshState(), tgt:{...freshState(), inh1:1}};
  const w1 = farmNextWalk([gA, gB], {howler1: 39}, true);
  eq('walk-craft: goal 1 crafts its tier-2 deficit from surplus', w1[0].rem.howler2, undefined);
  eq('walk-craft: goal 2 keeps its reserved tier-1 stock', w1[1].rem.howler1, undefined);
  const w2 = farmNextWalk([gA, gB], {howler1: 38}, true);
  eq('walk-craft: one short — 11 crafted, reserve still intact',
     [w2[0].rem.howler2, w2[1].rem.howler1], [1, undefined]);
  const w0 = farmNextWalk([gA], {howler1: 36}, false);
  eq('walk without craft flag is unchanged', w0[0].rem.howler2, 12);
}

// ═══ 9c. SPENDING (upgrade transactions) ═══
{
  eq('afford: pooled EXP compares totals', affordCost({exp4: 3}, {exp: 60000}), {});
  eq('afford: shortfall reported per id',
     affordCost({credits: 4000, whisperin0: 1}, {credits: 5000, whisperin0: 4, exp: 1000}),
     {credits: 1000, whisperin0: 3, exp: 1000});
  eq('plan: greedy floors then exact finish',
     poolPlan({exp4: 2, exp1: 5}, 41000, GAME.expItems), {plan: {exp4: 2, exp1: 1}, short: 0});
  eq('plan: smallest single held item covers a sliver',
     poolPlan({exp4: 9, exp1: 9}, 500, GAME.expItems), {plan: {exp1: 1}, short: 0});
  eq('plan: short when the pool runs dry',
     poolPlan({exp1: 2}, 5000, GAME.expItems), {plan: {exp1: 2}, short: 3000});
  const inv = {credits: 5000, whisperin0: 4, exp4: 1};
  eq('spend: refuses and leaves inv untouched when short',
     [spendCost(inv, {credits: 99999}), inv.credits], [false, 5000]);
  eq('spend: phoebe 20→20✦ drains the exact anchor cost, zeroed keys removed', (() => {
     const ok2 = spendCost(inv, costForGoal({char:'phoebe', cur:{...freshState(), ord:1}, tgt:{...freshState(), ord:2}}));
     return [ok2, inv.credits, inv.whisperin0, inv.exp4];
  })(), [true, undefined, undefined, 1]);
  const inv2 = {exp4: 100, exp1: 3};
  spendCost(inv2, {exp: 41000});
  eq('spend: EXP drinks greedily with minimal overflow', inv2, {exp4: 98, exp1: 2});

  // craft-aware spending (synth toggle): lower tiers cover higher-tier
  // costs — the "weapon 7th in the queue, only LF mats held" case
  eq('afford+craft: lower tiers cover a higher-tier cost',
     affordCost({whisperin0: 12, credits: 5000}, {whisperin1: 4, credits: 5000}, true), {});
  eq('afford without craft still reports the tier shortfall',
     affordCost({whisperin0: 12}, {whisperin1: 4}), {whisperin1: 4});
  eq("afford+craft: the cost's own lower-tier line is paid before crafting",
     affordCost({howler0: 9}, {howler0: 6, howler1: 1}, true), {});
  eq('afford+craft: short when what remains cannot chain',
     affordCost({howler0: 8}, {howler0: 6, howler1: 1}, true), {howler1: 1});
  const inv3 = {whisperin0: 13, credits: 6000};
  eq('spend+craft: crafts exactly and keeps the remainder',
     [spendCost(inv3, {whisperin1: 4, credits: 5000}, true), inv3.whisperin0, inv3.credits],
     [true, 1, 1000]);
}

// ═══ 10. REGISTRY & ORDINALS ═══
eq('ordinal labels', [ORD_LABEL(0), ORD_LABEL(1), ORD_LABEL(2), ORD_LABEL(13)],
   ['Lv 1','Lv 20','Lv 20 ✦','Lv 90']);
eq('shared weekly merges', MATS["wk:Sentinel's Dagger"].name, "Sentinel's Dagger");
eq('category of forge family', MATS.helix3.cat, 'Forgery');
eq('category of common family', MATS.kernel0.cat, 'Enemy Drops');

// ═══ 11. WEAPONS — FULL 5★ BUILD: Lv1→90 ═══
// Verified vs Game8 per-rank tables (Ages of Harvest 458249, Luminous Hymn
// 498527) + wuthering.gg spot-checks: ascension credits 330,000; forge tiers
// 6/8/6/20; enemy tiers 6/6/10/12; EXP 2,692,400 @ 0.4 credits/EXP.
for(const wid of ['agesOfHarvest','luminousHymn','firstlightsHerald']){
  const wp = GAME.weapons[wid];
  const bag = costForGoal({weapon:wid, cur:freshWpnState(), tgt:maxedWpnState()});
  eq(`${wid} full: forge`,   [0,1,2,3].map(t=>bag[wp.forge+t]),  [6,8,6,20]);
  eq(`${wid} full: commons`, [0,1,2,3].map(t=>bag[wp.common+t]), [6,6,10,12]);
  eq(`${wid} full: credits`, bag.credits, 330000 + Math.round(2692400*0.4)); // 1,406,960
  eq(`${wid} full: wexp`,    bag.wexp, 2692400);
  eq(`${wid} full: no char-only mats`, Object.keys(bag).some(k => /^(boss|spec|wk):|^exp$/.test(k)), false);
}

// ═══ 11b. WEAPONS — FULL 4★ BUILD: Lv1→90 ═══
// Datamine anchors (WeaponBreach/WeaponLevel, all 4★ share the table):
// ascension credits 264,000; forge 5/7/5/17; enemy 5/5/9/11; EXP 2,289,200.
for(const wid of ['autumntrace','lumingloss','thunderbolt','stonard','augment']){
  const wp = GAME.weapons[wid];
  const bag = costForGoal({weapon:wid, cur:freshWpnState(), tgt:maxedWpnState()});
  eq(`${wid} full: forge`,   [0,1,2,3].map(t=>bag[wp.forge+t]),  [5,7,5,17]);
  eq(`${wid} full: commons`, [0,1,2,3].map(t=>bag[wp.common+t]), [5,5,9,11]);
  eq(`${wid} full: credits`, bag.credits, 264000 + Math.round(2289200*0.4)); // 1,179,680
  eq(`${wid} full: wexp`,    bag.wexp, 2289200);
}

// ═══ 11c. WEAPON CATALOG — full 4★/5★ roster through 3.5 ═══
// 89 weapons (46 5★ + 43 4★), families verified per weapon from the fandom
// wiki "Ascends with" categories + wuthering.gg/Game8 for the gaps (Jul 2026).
{
  const ws = Object.values(GAME.weapons);
  eq('catalog: 89 weapons', ws.length, 89);
  eq('catalog: 46 five-star', ws.filter(w => w.rarity === 5).length, 46);
  eq('catalog: 43 four-star', ws.filter(w => w.rarity === 4).length, 43);
  const TYPES = ['Broadblade','Sword','Pistols','Gauntlets','Rectifier'];
  eq('catalog: every entry well-formed', ws.filter(w =>
      w.name && w.mono && TYPES.includes(w.wtype) &&
      Array.isArray(GAME.families[w.common]) && Array.isArray(GAME.families[w.forge]) &&
      typeof w.beta === 'boolean').length, 89);
  eq('catalog: unique display names', new Set(ws.map(w => w.name)).size, 89);
  // 3.x (Rikka) generation weapon: new-region forge + enemy families flow
  // through the same shared templates
  const bag = costForGoal({weapon:'everbrightPolestar', cur:freshWpnState(), tgt:maxedWpnState()});
  eq('3.x weapon full: forge (polarizer)', [0,1,2,3].map(t=>bag['polarizer'+t]), [6,8,6,20]);
  eq('3.x weapon full: commons (mech)',    [0,1,2,3].map(t=>bag['mech'+t]),      [6,6,10,12]);
  eq('3.x weapon full: credits', bag.credits, 1406960);
}

// ═══ 12. WEAPONS — PARTIAL RANGE: Lv50✦ (ord 6) → Lv80 unascended (ord 11) ═══
// wexp 1,822,800−451,200 = 1,371,600; ranks 4 & 5 crossed:
// credits 60k+80k + round(1,371,600×0.4)=548,640 → 688,640
// forge  r4 T3×6 + r5 T4×8 · enemy r4 T3×6 + r5 T4×4
{
  const bag = costForGoal({weapon:'agesOfHarvest', cur:{ord:6}, tgt:{ord:11}});
  eq('wpn 50✦→80: wexp', bag.wexp, 1371600);
  eq('wpn 50✦→80: credits', bag.credits, 688640);
  eq('wpn 50✦→80: forge',   [0,1,2,3].map(t=>bag['waveworn'+t]),  [undefined,undefined,6,8]);
  eq('wpn 50✦→80: commons', [0,1,2,3].map(t=>bag['whisperin'+t]), [undefined,undefined,6,4]);
}

// ═══ 13. WEAPONS — SINGLE ASCENSION: Lv20 → Lv20✦ (rank 1: no forge mat) ═══
{
  const bag = costForGoal({weapon:'luminousHymn', cur:{ord:1}, tgt:{ord:2}});
  eq('wpn 20→20✦: bag', bag, {credits:10000, rings0:6});
}

// ═══ 14. WEAPON EXP → ENERGY CORES (same greedy as potions) ═══
eq('cores 1,371,600', wexpToCores(1371600), {wexp4:68, wexp3:1, wexp2:1, wexp1:1});
eq('cores 0', wexpToCores(0), {});
eq('cores 500 (rounds up)', wexpToCores(500), {wexp1:1});

// ═══ 15. WEAPONS — INVENTORY: exp and wexp are separate pools ═══
{
  const need = totalBag([
    {char:'jinhsi', cur:{...freshState(), ord:11}, tgt:{...freshState(), ord:13}},   // char EXP only
    {weapon:'agesOfHarvest', cur:{ord:11}, tgt:{ord:13}},                            // weapon EXP only
  ]);
  // potions must NOT cover weapon EXP, cores must NOT cover character EXP
  const r = remainingBag(need, {exp4: 1000, credits: 10**9}, false);
  eq('potions never feed weapon EXP', r.rem.wexp, need.wexp);
  eq('char EXP covered by potions', r.rem.exp, undefined);
  const r2 = remainingBag(need, {wexp4: 1000, credits: 10**9}, false);
  eq('cores never feed char EXP', r2.rem.exp, need.exp);
  eq('weapon EXP covered by cores', r2.rem.wexp, undefined);
  eq('core plan for wexp remainder', r.corePlan, wexpToCores(need.wexp));
}

// ═══ 16. WEAPONS — FARM-NEXT WALK: mixed queue shares mats & credits ═══
{
  const gW = {weapon:'agesOfHarvest', cur:{ord:1}, tgt:{ord:2}};  // 6 whisperin0 + 10k
  const gC = {char:'phoebe', cur:{...freshState(), ord:1}, tgt:{...freshState(), ord:2}}; // 4 whisperin0 + 5k
  const walk = farmNextWalk([gW, gC], {whisperin0: 8, credits: 15000, wexp1: 50});
  eq('walk: weapon goal first, ready', walk[0].ready, true);
  eq('walk: char goal starved by weapon', walk[1].rem, {whisperin0: 2});
  // wexp pool depletes independently of exp pool
  const gW2 = {weapon:'agesOfHarvest', cur:{ord:0}, tgt:{ord:1}}; // 43,300 wexp + credits
  const walk2 = farmNextWalk([gW2], {wexp4: 2, exp4: 100, credits: 17320});
  eq('walk: cores partially cover wexp', walk2[0].rem, {wexp: 43300 - 40000});
}

// ═══ 17. WEAPONS — REGISTRY ═══
eq('wexp registered', [MATS.wexp.name, MATS.wexp.cat], ['Weapon EXP', 'EXP']);
eq('energy cores registered', GAME.wpnExpItems.map(it => MATS[it.id].name),
   ['Basic Energy Core','Medium Energy Core','Advanced Energy Core','Premium Energy Core']);
eq('weapon-only enemy family categorized', MATS.rings0.cat, 'Enemy Drops');
eq('weapon-only enemy family categorized (exoswarm)', MATS.exoswarm3.cat, 'Enemy Drops');

// ═══ 17b. PRIORITY-ORDERED AGGREGATE: P1's mats first, then P2's additions ═══
{
  const gP = {char:'phoebe', cur:{...freshState(), ord:0}, tgt:{...freshState(), ord:2}};  // credits, exp, whisperin0
  const gS = {weapon:'stonard', cur:{ord:0}, tgt:{ord:2}};                                  // credits, wexp, howler0
  eq('priority order: P1 block then P2 novelties',
     priorityMatIds([gP, gS]), ['credits','exp','whisperin0','wexp','howler0']);
  eq('priority order flips with the queue',
     priorityMatIds([gS, gP]), ['credits','wexp','howler0','exp','whisperin0']);
}

// ═══ 17c. DEFAULT GOAL TARGETS (per rarity, user-tuned) ═══
eq('default target 5★: Lv90 · forte 6 · all nodes', defaultGoalTgt(5),
   {ord:13, skills:[6,6,6,6,6], inh1:1, inh2:1, minor:4, major:4});
eq('default target 4★: Lv80 · forte 6 · all nodes + passives', defaultGoalTgt(4),
   {ord:11, skills:[6,6,6,6,6], inh1:1, inh2:1, minor:4, major:4});
// cost of one 5★ default goal: 853,300 lvl + 170,000 asc + 150,000 skills(→6)
// + 630,000 nodes = 1,803,300 credits · weekly 6 (inh Ⅰ+Ⅱ + 4 majors)
{
  const bag = costForGoal({char:'jinhsi', cur:freshState(), tgt:defaultGoalTgt(5)});
  eq('5★ default goal: credits', bag.credits, 1803300);
  eq('5★ default goal: weekly', bag["wk:Sentinel's Dagger"], 6);
}

// ═══ 17d. NODE SHORTFALL (Completed-tab indicator vs template plan) ═══
eq('shortfall: maxed build covers the full template', nodeShortfall(maxedState(), defaultGoalTgt(5)),
   {minor:0, major:0, inh1:0, inh2:0});
eq('shortfall: fresh build misses everything the template plans',
   nodeShortfall(freshState(), defaultGoalTgt(5)), {minor:4, major:4, inh1:1, inh2:1});
eq('shortfall: partial build lists what is missing',
   nodeShortfall({minor:4, major:2, inh1:1, inh2:0}, defaultGoalTgt(5)),
   {minor:0, major:2, inh1:0, inh2:1});
eq('shortfall: skipping nodes in the template forgives them',
   nodeShortfall({minor:2, major:0, inh1:1, inh2:0}, {minor:2, major:0, inh1:1, inh2:0}),
   {minor:0, major:0, inh1:0, inh2:0});
eq('shortfall: overbuilt never goes negative',
   nodeShortfall(maxedState(), {minor:1, major:0, inh1:0, inh2:0}), {minor:0, major:0, inh1:0, inh2:0});

// ═══ 18. COMPACT QUANTITIES (material tiles): 3 significant digits ═══
eq('fmtShort exact under 10k', [fmtShort(46), fmtShort(999), fmtShort(9999)], ['46','999','9,999']);
eq('fmtShort K range', [fmtShort(10000), fmtShort(43300), fmtShort(505200), fmtShort(915680)],
   ['10K','43.3K','505K','916K']);
eq('fmtShort M range', [fmtShort(1000000), fmtShort(2438000), fmtShort(9159900), fmtShort(3053300)],
   ['1M','2.44M','9.16M','3.05M']);

// ═══ 19. FUZZY MATCH (add-goal palette) ═══
eq('fuzzy: subsequence hits', fuzzyScore('aoh', 'Ages of Harvest') >= 0, true);
eq('fuzzy: scattered letters still match', fuzzyScore('crl', 'Carlotta') >= 0, true);
eq('fuzzy: out-of-order letters do not', fuzzyScore('hoa', 'Ages of Harvest'), -1);
eq('fuzzy: no match', fuzzyScore('xyz', 'Carlotta'), -1);
eq('fuzzy: shorter name wins the tie', fuzzyScore('car', 'Carlotta') < fuzzyScore('car', 'Cartethyia'), true);
eq('fuzzy: start-of-name beats mid-name', fuzzyScore('ta', 'Taoqi') < fuzzyScore('ta', 'Cantarella'), true);
eq('fuzzy: empty query matches everything at 0', fuzzyScore('', 'Jinhsi'), 0);
eq('fuzzy: case-insensitive', fuzzyScore('JINHSI', 'Jinhsi') >= 0, true);

// ═══ 19a. STRIP CREDITS & EXP (the "Ignore credits & EXP" planning filter) ═══
eq('stripCE drops exactly the three pooled ids',
   stripCE({credits: 505200, exp: 1272000, wexp: 99, howler0: 4, 'boss:Elegy Tacet Core': 21}),
   {howler0: 4, 'boss:Elegy Tacet Core': 21});
eq('stripCE on an empty bag', stripCE({}), {});
eq('stripCE never mutates its input', (() => {
   const b = {credits: 1, howler0: 2}; stripCE(b); return b; })(), {credits: 1, howler0: 2});

// ═══ 19b. WAVEPLATE ESTIMATES (endgame yields, community drop-rate sheet) ═══
{
  // clean single-activity anchors: 9 boss mats = 2 claims = 120 plates;
  // 3 weekly mats = 1 claim = 60; 51 tier-0 forge = 1 run = 40 (tier-3 ×27);
  // one sim run each of EXP / weapon EXP / credits = 40 apiece
  eq('wp: boss', waveplateEstimate({'boss:Elegy Tacet Core': 9}).plates, 120);
  const wk = waveplateEstimate({"wk:Sentinel's Dagger": 3});
  eq('wp: weekly + claim count', [wk.plates, wk.weeklyRuns], [60, 1]);
  eq('wp: forgery tier-0', waveplateEstimate({waveworn0: 51}).plates, 40);
  eq('wp: forgery tier-3 is 27× tier-0', waveplateEstimate({waveworn3: 51}).plates, 27 * 40);
  eq('wp: sim runs', [waveplateEstimate({exp: 78440}).plates,
                      waveplateEstimate({wexp: 79059}).plates,
                      waveplateEstimate({credits: 84000}).plates], [40, 40, 40]);
  eq('wp: overworld mats cost nothing but are reported',
     (() => { const r = waveplateEstimate({'spec:Belle Poppy': 60, howler0: 29});
              return [r.plates, r.overworld.sort()]; })(),
     [0, ['howler0', 'spec:Belle Poppy']]);
  eq('wp: empty bag', waveplateEstimate({}), {plates:0, days:0, weeklyRuns:0, overworld:[],
     by:{boss:0, weekly:0, forgery:0, exp:0, wexp:0, credits:0}});

  // full-build anchors (hand-computed from the seeded yields):
  // 5★ char: boss 613.3 + weekly 520 + forgery 1892.5 (2,413 t0-equiv)
  //          + EXP 1243.2 + credits 1454.0 → ⌈5723.08⌉ = 5724 (≈23.85 days)
  const full = waveplateEstimate(costForGoal({char:'jinhsi', cur:freshState(), tgt:maxedState()}));
  eq('wp: full 5★ character build', [full.plates, full.weeklyRuns, full.overworld.length],
     [5724, 9, 5]);
  eq('wp: full-build days at 240/day', Math.round(full.days * 100) / 100, 23.85);
  // 5★ weapon: forgery 489.4 (624 t0-equiv) + wexp 1362.2 + credits 670.0 → ⌈2521.62⌉ = 2522
  const wfull = waveplateEstimate(costForGoal({weapon:'agesOfHarvest', cur:freshWpnState(), tgt:maxedWpnState()}));
  eq('wp: full 5★ weapon build', [wfull.plates, wfull.weeklyRuns], [2522, 0]);
}

// ═══ 20. TEAMS (matrix team builder) ═══
{
  const ROSTER = ['jinhsi', 'phoebe', 'suisui', 'sanhua'];
  eq('energy defaults to 1', charEnergy('jinhsi'), 1);
  eq('seeded supports carry energy 2',
     ['verina','shorekeeper','suisui','chisa','mornye','buling'].map(charEnergy), [2,2,2,2,2,2]);
  eq('a seeded support may hold two teams (real data, no energyOf override)',
     sanitizeTeams([{chars:['verina', null, null]}, {chars:['verina', null, null]}], ['verina']),
     [{chars:['verina', null, null]}, {chars:['verina', null, null]}]);
  eq('usage counts placements across teams', teamUsage([
    {chars:['jinhsi', 'phoebe', null]}, {chars:['jinhsi', null, null]}]),
    {jinhsi:2, phoebe:1});
  eq('energyLeft: unplaced char has its full budget',
     energyLeft([{chars:['jinhsi', null, null]}], 'phoebe'), 1);
  eq('energyLeft: placed char is spent at energy 1',
     energyLeft([{chars:['jinhsi', null, null]}], 'jinhsi'), 0);
  eq('energyLeft honors a bigger budget via energyOf',
     energyLeft([{chars:['jinhsi', null, null]}], 'jinhsi', () => 2), 1);

  eq('sanitizeTeams: non-array → no teams', sanitizeTeams(undefined, ROSTER), []);
  eq('sanitizeTeams: garbage rows drop, slots pad to 3',
     sanitizeTeams(['nope', null, {chars:['jinhsi']}], ROSTER),
     [{chars:['jinhsi', null, null]}]);
  eq('sanitizeTeams: unknown + non-roster ids drop to empty slots',
     sanitizeTeams([{chars:['jinhsi', 'notachar', 'verina']}], ROSTER),
     [{chars:['jinhsi', null, null]}]);
  eq('sanitizeTeams: a char appears once per team, extra slots clamp',
     sanitizeTeams([{chars:['jinhsi', 'jinhsi', 'phoebe', 'sanhua']}], ROSTER),
     [{chars:['jinhsi', null, 'phoebe']}]);
  eq('sanitizeTeams: energy 1 = one team total; earlier teams win',
     sanitizeTeams([{chars:['jinhsi', 'phoebe', null]}, {chars:['jinhsi', 'suisui', null]}], ROSTER),
     [{chars:['jinhsi', 'phoebe', null]}, {chars:[null, 'suisui', null]}]);
  eq('sanitizeTeams: energy 2 lets the same char join two teams (not twice in one)',
     sanitizeTeams([{chars:['jinhsi', 'jinhsi', null]}, {chars:['jinhsi', null, null]},
                    {chars:['jinhsi', null, null]}], ROSTER, () => 2),
     [{chars:['jinhsi', null, null]}, {chars:['jinhsi', null, null]}, {chars:[null, null, null]}]);
  eq('sanitizeTeams: a real name survives, junk names drop',
     sanitizeTeams([{name:'  Tower A ', chars:[]}, {name:42, chars:[]}, {name:'   ', chars:[]}], ROSTER),
     [{name:'Tower A', chars:[null, null, null]}, {chars:[null, null, null]},
      {chars:[null, null, null]}]);
}

// ═══ 21. DAILY PLAN (today's waveplate budget → whole runs) ═══
{
  const W = GAME.waveplates;
  const firstOf = cat => Object.keys(MATS).find(id => MATS[id].cat === cat);
  const BOSS = firstOf('Boss Drops'), WK = firstOf('Weekly Boss'), SPEC = firstOf('Specialty');
  const FG = Object.keys(MATS).find(id => MATS[id].cat === 'Forgery' && MATS[id].tier === 0);
  const FAM = MATS[FG].family;
  const keys = p => p.runs.map(r => r.key);

  eq('empty queue plans nothing', dailyPlan([]), {runs:[], used:0, leftover:240, overworld:[], weeklyCapped:false});
  eq('an empty bag plans nothing', dailyPlan([{}]).runs, []);

  // 9 boss mats at 4.5/claim = 2 claims; the budget is not spent past the demand
  {
    const p = dailyPlan([{[BOSS]: 9}]);
    eq('boss demand rounds up to whole claims', p.runs,
       [{key:'boss:' + BOSS, kind:'boss', id:BOSS, runs:2, cost:120, yield:9}]);
    eq('used = plate cost of the runs', [p.used, p.leftover], [120, 120]);
  }
  // a partial claim still costs a whole claim
  eq('one mat short of a claim still books one claim', dailyPlan([{[BOSS]: 1}]).runs[0].runs, 1);

  // the budget bounds the plan
  eq('a 60⚡ budget buys one boss claim', dailyPlan([{[BOSS]: 99}], 60).runs[0].runs, 1);
  eq('a 40⚡ budget buys no boss claim at all', dailyPlan([{[BOSS]: 99}], 40).runs, []);
  eq('…but still buys a 40⚡ forgery run', dailyPlan([{[BOSS]: 99, [FG]: 999}], 40).runs,
     [{key:'fg:' + FAM, kind:'forgery', id:FAM + '3', runs:1, cost:40, yield:W.forgery.t0Equiv}]);

  // forgery tiers collapse onto one domain, weighted 3× per tier
  {
    const p = dailyPlan([{[FAM + '1']: W.forgery.t0Equiv / 3}]);   // 17 t1 = 51 t0-equiv = 1 run
    eq('a forgery family is one domain, tiers weighted 3×', p.runs.map(r => [r.key, r.runs]),
       [['fg:' + FAM, 1]]);
  }

  // weekly bosses: 3 claims per week, however deep the demand or budget
  {
    const p = dailyPlan([{[WK]: 30}], 600);                        // demand 10 claims
    eq('weekly claims stop at the 3/week cap', [p.runs[0].runs, p.weeklyCapped], [3, true]);
    eq('an uncapped weekly demand does not raise the flag', dailyPlan([{[WK]: 3}]).weeklyCapped, false);
  }

  // overworld mats are pickups: no runs, listed separately
  {
    const p = dailyPlan([{[SPEC]: 60}]);
    eq('specialty mats cost no waveplates', [p.runs, p.overworld], [[], [SPEC]]);
  }

  // the pools each get their own simulation
  eq('credits / EXP / weapon EXP map to their sims',
     keys(dailyPlan([{credits: 84000, exp: 78440, wexp: 79059}])).sort(),
     ['credits', 'exp', 'wexp']);
  eq('an EXP sim is priced and yielded from GAME.waveplates',
     dailyPlan([{exp: 78440}]).runs[0], {key:'exp', kind:'exp', id:'exp4', runs:1, cost:40, yield:78440});
  eq('potion items never appear as runs (they feed the pool)', dailyPlan([{exp4: 9}]).runs, []);

  // priority: goal 0 is served first, and a later goal cannot pull runs forward
  {
    const p = dailyPlan([{[FG]: 999}, {[BOSS]: 99}], 80);
    eq('the top goal takes the whole budget when it can use it', keys(p), ['fg:' + FAM]);
    eq('…two runs of it', p.runs[0].runs, 2);
  }
  {
    const p = dailyPlan([{[FG]: W.forgery.t0Equiv}, {[BOSS]: 9}], 240);  // goal 0 wants exactly 1 run
    eq('a covered top goal spills the rest into the next', keys(p), ['fg:' + FAM, 'boss:' + BOSS]);
    eq('spillover respects the next goal’s demand', p.runs.map(r => r.runs), [1, 2]);
    eq('the plan is priced end to end', [p.used, p.leftover], [160, 80]);
  }
  {
    // the same boss serves both goals: goal 0 needs 1 claim, goal 1 needs 2 more
    const p = dailyPlan([{[BOSS]: 4}, {[BOSS]: 9}], 60);
    eq('a shared activity is capped at the demand of the goals reached so far',
       p.runs[0].runs, 1);
    eq('…and the full demand is bought once the later goal is reached',
       dailyPlan([{[BOSS]: 4}, {[BOSS]: 9}], 240).runs[0].runs, 3);
  }

  // water-filling inside one goal: the biggest remaining demand takes each run
  {
    const p = dailyPlan([{[FG]: W.forgery.t0Equiv, [BOSS]: 4}], 100);   // one run of each
    eq('one goal’s activities share the budget', keys(p).sort(), ['boss:' + BOSS, 'fg:' + FAM]);
    eq('…and the plan spends it all', p.used, 100);
    const big = dailyPlan([{[FG]: 999, [BOSS]: 4}], 100);
    eq('a much larger demand keeps taking runs (water-filling, not round-robin)',
       big.runs.map(r => [r.key, r.runs]), [['fg:' + FAM, 2]]);
  }
  // the weekly's 3/week cap is a use-it-or-lose-it resource: it outranks demand
  {
    const p = dailyPlan([{[FG]: 9999, [WK]: 3}], 100);
    eq('a weekly claim is scheduled ahead of a far bigger forgery demand',
       p.runs.map(r => [r.key, r.runs]), [['wk:' + WK, 1], ['fg:' + FAM, 1]]);
  }
}

// ═══ 22. MATERIAL FAMILIES (the farm pop-up's contents) ═══
{
  eq('a family material yields its four tiers, low → high',
     familyIds('howler2'), ['howler0','howler1','howler2','howler3']);
  eq('any tier of the family gives the same ladder', familyIds('howler0'), familyIds('howler3'));
  eq('the resonator EXP pool yields the potion ladder',
     familyIds('exp'), GAME.expItems.map(x => x.id));
  eq('a potion item yields the same ladder', familyIds('exp2'), GAME.expItems.map(x => x.id));
  eq('the weapon EXP pool yields the core ladder — never the potions',
     familyIds('wexp'), GAME.wpnExpItems.map(x => x.id));
  eq('a core item yields the cores', familyIds('wexp0'), GAME.wpnExpItems.map(x => x.id));
  {
    const boss = Object.keys(MATS).find(id => MATS[id].cat === 'Boss Drops');
    eq('a boss drop is a singleton', familyIds(boss), [boss]);
    eq('credits are a singleton', familyIds('credits'), ['credits']);
  }

  eq('a family label is the words its tiers share at the end',
     famLabel(familyIds('howler0')), 'Howler Core');
  eq('…even when only one word is shared', famLabel(familyIds('rings0')), 'Ring');
  eq('…and the shared words may be a prefix instead',
     famLabel(familyIds('waveworn0')), 'Waveworn Residue');
  eq('a parenthesized tier suffix leaves a prefix label',
     famLabel(familyIds('kernel0')), 'Autopuppet Kernel');
  eq('the potion ladder shares its tail', famLabel(familyIds('exp')), 'Resonance Potion');
  eq('a singleton labels itself', famLabel(['credits']), 'Shell Credit');
  // every family in the data resolves to a non-empty label shorter than a full name
  {
    const bad = Object.keys(GAME.families).filter(f => {
      const l = famLabel(familyIds(f + '0'));
      return !l || l.length >= MATS[f + '0'].name.length;
    });
    eq('every seeded family shortens to a shared label', bad, []);
  }
}

// ═══ forte stat-bonus nodes (datamined, ConfigDB/SkillTree.json) ═══
{
  // symmetric layout: cols 0 & 4 = outer stat, 1 & 3 = inner, 2 = inherent (null)
  const jh = statNodesFor('jinhsi');
  eq('jinhsi node stats: 5 columns', jh.length, 5);
  eq('jinhsi cols 0 & 4 are the outer stat (crit rate)',
     [jh[0].key, jh[4].key], ['critRate', 'critRate']);
  eq('jinhsi cols 1 & 3 are the inner stat (ATK)',
     [jh[1].key, jh[3].key], ['atk', 'atk']);
  eq('jinhsi column 2 is inherent — no stat node', jh[2], null);
  eq('crit rate node values (minor/major)', [jh[0].minor, jh[0].major], [1.2, 2.8]);
  eq('ATK node values (minor/major)', [jh[1].minor, jh[1].major], [1.8, 4.2]);
  eq('a stat carries its display label', jh[0].label, 'Crit. Rate');

  // total forte crit rate = 2 columns × (minor + major) — community anchor 8%
  eq('total forte crit rate is 8%', 2 * (jh[0].minor + jh[0].major), 8);
  const cd = statNodesFor('xiangliYao');
  eq('total forte crit dmg is 16%', 2 * (cd[0].minor + cd[0].major), 16);

  // non-ATK inner stats and off-crit outer stats
  eq('shorekeeper is healing (outer) + HP (inner)',
     [statNodesFor('shorekeeper')[0].key, statNodesFor('shorekeeper')[1].key], ['healing', 'hp']);
  eq('mornye is healing (outer) + DEF (inner)',
     [statNodesFor('mornye')[0].key, statNodesFor('mornye')[1].key], ['healing', 'def']);
  eq('cartethyia is crit rate (outer) + HP (inner)',
     [statNodesFor('cartethyia')[0].key, statNodesFor('cartethyia')[1].key], ['critRate', 'hp']);
  eq('lingyang is Glacio DMG (outer) + ATK (inner)',
     [statNodesFor('lingyang')[0].key, statNodesFor('lingyang')[1].key], ['glacioDmg', 'atk']);
  eq('DEF node values differ from ATK', [statNodesFor('mornye')[1].minor, statNodesFor('mornye')[1].major], [2.28, 5.32]);

  // coverage / integrity
  eq('a post-3.1 character (no datamine data) returns null', statNodesFor('suisui'), null);
  eq('an unknown id returns null', statNodesFor('nobody'), null);
  const keys = Object.keys(GAME.charStatNodes);
  eq('35 characters have node data', keys.length, 35);
  eq('every keyed character exists and is 5★',
     keys.filter(k => (GAME.characters[k] || {}).rarity !== 5), []);
  eq('every named stat exists in the shared value table',
     keys.flatMap(k => GAME.charStatNodes[k]).filter(s => !GAME.nodeStats[s]), []);
}

// ═══ forteStatTotals: sum a build's forte stat bonuses ═══
{
  const g = (nodes, char = 'jinhsi') => ({char, cur:{}, tgt:{}, nodes});
  const all = v => [[v,v,v,v,v],[v,v,v,v,v]];   // 2×5 matrix filled with v

  // a fully-owned Jinhsi tree: crit rate 8% (2 cols × [1.2+2.8]), ATK 18.4% (2 × [1.8+4.2])
  eq('full owned build totals both stats, outer stat first',
     forteStatTotals(g(all(2)), 'cur'),
     [{key:'critRate', label:'Crit. Rate', pct:8}, {key:'atk', label:'ATK', pct:12}]);
  eq('full planned build, same totals under the tgt side', forteStatTotals(g(all(1)), 'tgt'),
     [{key:'critRate', label:'Crit. Rate', pct:8}, {key:'atk', label:'ATK', pct:12}]);

  // side matters: planned-only nodes count for tgt, not cur
  eq('planned nodes do not count toward the owned (cur) total', forteStatTotals(g(all(1)), 'cur'), []);
  eq('a skipped build grants nothing', forteStatTotals(g(all(0)), 'tgt'), []);

  // partial: own only the two lower ATK nodes (cols 1 & 3, row 0) → ATK 3.6%
  eq('owning just the two minor ATK nodes → 1.8 × 2', (() => {
    const m = all(0); m[0][1] = 2; m[0][3] = 2; return forteStatTotals(g(m), 'cur');
  })(), [{key:'atk', label:'ATK', pct:3.6}]);

  // one lower + one upper crit column: 1.2 + 2.8 = 4 (float-clean)
  eq('a single owned crit column totals 4%', (() => {
    const m = all(0); m[0][0] = 2; m[1][0] = 2; return forteStatTotals(g(m), 'cur');
  })(), [{key:'critRate', label:'Crit. Rate', pct:4}]);

  // the center (inherent) column never contributes a stat
  eq('the inherent column is ignored', (() => {
    const m = all(0); m[0][2] = 2; m[1][2] = 2; return forteStatTotals(g(m), 'cur');
  })(), []);

  // DEF rounds cleanly (2.28 + 5.32) × 2 columns = 15.2
  eq('mornye DEF totals 15.2% with no float noise',
     forteStatTotals(g(all(2), 'mornye'), 'cur').find(s => s.key === 'def').pct, 15.2);

  // guards: weapons and data-less characters and null goals
  eq('a weapon goal has no forte stats', forteStatTotals({weapon:'stonard', nodes:undefined}, 'tgt'), null);
  eq('a post-3.1 character returns null even with a full tree', forteStatTotals(g(all(2), 'suisui'), 'cur'), null);
  eq('a nodeless goal returns null', forteStatTotals({char:'jinhsi'}, 'tgt'), null);
  eq('defaults to the tgt side', forteStatTotals(g(all(1))), forteStatTotals(g(all(1)), 'tgt'));
}

// ═══ 23. OVERWORLD BAG (materials that cost no waveplates) ═══
{
  const firstOf = cat => Object.keys(MATS).find(id => MATS[id].cat === cat);
  const BOSS = firstOf('Boss Drops'), WK = firstOf('Weekly Boss'), SPEC = firstOf('Specialty');
  const ENEMY = firstOf('Enemy Drops'), FORGE = firstOf('Forgery');

  eq('specialty mats are free to farm', isOverworld(SPEC), true);
  eq('common enemy drops are free to farm', isOverworld(ENEMY), true);
  eq('boss drops cost waveplates', isOverworld(BOSS), false);
  eq('weekly drops cost waveplates', isOverworld(WK), false);
  eq('forgery mats cost waveplates', isOverworld(FORGE), false);
  eq('credits cost waveplates (sim domain)', isOverworld('credits'), false);
  eq('the EXP pool is not a farmable material', isOverworld('exp'), false);
  eq('potion items are not overworld mats', isOverworld('exp4'), false);
  eq('an unknown id is not overworld', isOverworld('nope'), false);

  eq('overworldBag keeps only the free-to-farm entries',
     overworldBag({[SPEC]: 60, [ENEMY]: 29, [BOSS]: 46, [WK]: 26, [FORGE]: 25, credits: 100, exp: 5}),
     {[SPEC]: 60, [ENEMY]: 29});
  eq('non-positive quantities are dropped', overworldBag({[SPEC]: 0, [ENEMY]: -3}), {});
  eq('an empty bag yields an empty bag', overworldBag({}), {});
  eq('overworldBag does not mutate its input', (() => {
    const b = {[SPEC]: 60, [BOSS]: 46};
    overworldBag(b);
    return JSON.stringify(b);
  })(), JSON.stringify({[SPEC]: 60, [BOSS]: 46}));

  // the invariant: overworldBag's keys are exactly what waveplateEstimate
  // books to `overworld` (i.e. charges no waveplates for) — keep them in sync
  {
    const full = totalBag([{char:'jinhsi', cur:freshState(), tgt:maxedState()},
                           {weapon:'agesOfHarvest', cur:freshWpnState(), tgt:maxedWpnState()}]);
    eq('overworldBag agrees with waveplateEstimate’s overworld list',
       Object.keys(overworldBag(full)).sort(),
       waveplateEstimate(full).overworld.slice().sort());
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);