// Test harness: evals the planner's <script> blocks (no DOM needed) and
// validates the engine against independently known totals.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'wuwa-planner.html'), 'utf8');
// blocks 0–1 are data + engine (pure); block 2 is the DOM-bound UI layer
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).slice(0, 2);
eval(blocks.join('\n;\n') + `
;Object.assign(globalThis, {GAME, MATS, MILES, ORD_LEVEL, ORD_LABEL, CATEGORY_ORDER,
  costForGoal, totalBag, freshState, maxedState, expToPotions, remainingBag, farmNextWalk, sortMatIds});`);

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
for(const cid of ['jinhsi','phoebe','suisui']){
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

// ═══ 6. EXP → POTIONS: exact greedy with minimal overflow ═══
eq('potions 1,272,000', expToPotions(1272000), {exp4:63, exp3:1, exp2:1, exp1:1});
eq('potions 0', expToPotions(0), {});
eq('potions 500 (rounds up)', expToPotions(500), {exp1:1});

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

// ═══ 10. REGISTRY & ORDINALS ═══
eq('ordinal labels', [ORD_LABEL(0), ORD_LABEL(1), ORD_LABEL(2), ORD_LABEL(13)],
   ['Lv 1','Lv 20','Lv 20 ✦','Lv 90']);
eq('shared weekly merges', MATS["wk:Sentinel's Dagger"].name, "Sentinel's Dagger");
eq('category of forge family', MATS.helix3.cat, 'Forgery');
eq('category of common family', MATS.kernel0.cat, 'Enemy Drops');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);