// UI smoke test: loads the real file in jsdom and simulates user interaction.
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'wuwa-planner.html'), 'utf8');
const dom = new JSDOM(html, {runScripts:'dangerously', url:'https://localhost/', pretendToBeVisual:true});
const w = dom.window, d = w.document;

let pass = 0, fail = 0;
const ok = (label, cond) => { (cond ? pass++ : fail++); console.log((cond ? 'PASS' : 'FAIL') + '  ' + label); };
const fire = (el, type) => el.dispatchEvent(new w.Event(type, {bubbles:true}));
const texts = sel => [...d.querySelectorAll(sel)].map(e => e.textContent);

// ── per-block isolation ──
// The suite runs against one shared jsdom. Everything below the persistence
// round-trip is an independent feature block; each calls reset() first so a
// leak in one (a left-on toggle, an undeleted goal, an open pop-up, an
// edited template) can't corrupt the next. reset() rebuilds the default
// queue (Jinhsi/Phoebe/Suisui) from STANDARD templates, clears inventory /
// done / teams / undo, closes every pop-up, and returns to the Ledger page's
// Total tab — the same state a fresh boot produces. A block that needs more
// (inventory, a completed goal, an extra goal) sets it up explicitly after
// resetting, so its preconditions never depend on run order.
const reset = () => w.eval(`
  const D = {4: defaultGoalTgt(4), 5: defaultGoalTgt(5)};
  state = {goals: ['jinhsi','phoebe','suisui'].map(c => newGoal(c, false, D)),
           done: [], inv: {}, synth: true, craftMode: 'reserve', hideUn: false, skipCE: false,
           tab: 'total', teams: [], builds: {}, defaults: D, week: freshWeek()};
  undoStack.length = 0; clearTimeout(undoTimer);
  editIdx = null; editTpl = null; palPick = null; palSel = 0;
  echoFilter = '';
  farmId = null; ordDrag = null; invFilter = '';
  for(const s of ['#modalWrap','#palWrap','#ordWrap','#invWrap','#farmWrap','#undoBar'])
    $(s).hidden = true;
  if(location.hash) location.hash = '';
  showPage('ledger');
  save(); render();
`);

// ── initial render: summary left, read-only status cards right ──
ok('3 goal cards rendered', d.querySelectorAll('.goal').length === 3);
ok('priority order J/P/S', texts('.gname').join(',').startsWith('Jinhsi,Phoebe,Suisui'));
ok('no beta badges on the default queue (3.5 data launch-verified)', d.querySelectorAll('.badge').length === 0);
ok('summary aside precedes goals section', d.querySelector('.cols > aside:first-child + section') !== null);
ok('cards are read-only (no selects, no node buttons)',
   d.querySelectorAll('#goals select, #goals button.node').length === 0);
ok('every card always shows its materials as tiles', d.querySelectorAll('#goals .goal .goal-mats .tiles').length === 3);
ok('mini trees with skill levels on all char cards (default target: forte 6)',
   d.querySelectorAll('#goals .mini').length === 3 &&
   d.querySelectorAll('#goals .mini .node').length === 30 &&
   [...d.querySelectorAll('#goals .mini .sk')].every(s => s.textContent === '1→6'));
ok('breakdown accordion gone', d.querySelector('details.brk') === null);
ok('summary shows totals as tile grid', d.querySelectorAll('#summary .tiles .tile').length > 10 &&
   d.querySelector('#summary table.mats') === null);
ok('storage detected (jsdom has localStorage)', /Autosaves/.test(d.querySelector('#storageNote').textContent));
ok('queue subtitle no longer hardcodes a per-row count',
   !/per row/.test([...d.querySelectorAll('.panel-h .sub')].map(e => e.textContent).join(' ')));
ok('footer keeps its pills but collapses the help into a closed <details>',
   d.querySelectorAll('#footer .pill').length === 3 &&
   d.querySelector('#footer details.foot-help') !== null &&
   d.querySelector('#footer details.foot-help').open === false &&
   /How this works/.test(d.querySelector('#footer summary').textContent));

// grand total sanity: 3 default-target builds (Lv90 · forte 6 · all nodes) →
// credits 3 × 1,803,300 = 5,409,900; Sentinel's Dagger = 6+6 = 12
const creditTile = d.querySelector('#summary .tile[title^="Shell Credit — 5,409,900 needed"]');
ok('total credits 3× default build (exact in title, 5.41M on tile)',
   creditTile !== null && creditTile.textContent.includes('5.41M') && !creditTile.textContent.includes('Shell Credit'));
ok("shared weekly (Sentinel's Dagger) merged to 12",
   d.querySelector(`#summary .tile[title^="Sentinel's Dagger — 12 needed"]`) !== null);
const expTile = [...d.querySelectorAll('#summary .tile')].find(t => t.title.startsWith('Resonator EXP'));
ok('total EXP tile counts top-tier potions (7,314,000 ÷ 20k → 366), exact EXP + plan in tooltip',
   expTile && expTile.title.includes('7,314,000') && expTile.title.includes('≈') &&
   expTile.textContent.includes('366') && !expTile.textContent.includes('7.31M'));
ok('tiles carry rarity grounds', d.querySelector('#summary .tile.r5') !== null &&
   d.querySelector('#summary .tile.r2') !== null && d.querySelector('#goals .tile.r4') !== null);

// ── readiness bars: per-card waveplate estimate + Total-tab summary line ──
{
  ok('every unfinished card carries a readiness bar', d.querySelectorAll('#goals .goal .ready').length === 3);
  const bar = () => d.querySelector('.goal[data-g="0"] .ready');
  ok('fresh goals start at 0% with a waveplate label (icon, not ⚡ text)',
     bar().querySelector('.ready-fill').getAttribute('style').includes('width:0%') &&
     bar().querySelector('.ready-lbl .wp-ico') !== null &&
     !bar().querySelector('.ready-lbl').textContent.includes('⚡'));
  ok('the waveplate glyph resolves to the fetched icon file',
     bar().querySelector('.ready-lbl .wp-ico').getAttribute('src') === 'images/materials/waveplate_icon.png');
  ok('bar tooltip breaks the estimate down by activity',
     (bar().getAttribute('title') || '').includes('boss ≈') &&
     bar().getAttribute('title').includes('3/week cap') &&
     bar().getAttribute('title').includes('overworld'));
  ok('Total tab shows the aggregate waveplate line, iconized', (() => {
     const line = [...d.querySelectorAll('#summary .gmeta')].find(x => /240\/day/.test(x.textContent));
     const g = [...d.querySelectorAll('#summary .gmeta')].map(x => x.textContent).join(' ');
     return line && line.querySelector('.wp-ico') !== null &&
            g.includes('240/day') && g.includes('weekly claims') && !g.includes('⚡'); })());
  // stocking inventory moves the bar (and reverts cleanly)
  w.eval(`state.inv['boss:Elegy Tacet Core'] = 21; save(); render();`);
  ok('inventory pushes the bar off 0%',
     !bar().querySelector('.ready-fill').getAttribute('style').includes('width:0%'));
  w.eval(`delete state.inv['boss:Elegy Tacet Core']; save(); render();`);
}

// ── "Ignore credits & EXP" toggle: strips both pools from every planning view ──
{
  const titles = () => [...d.querySelectorAll('#summary .tile')].map(t => t.getAttribute('title') || '');
  const ce = () => d.querySelector('#ceChk');
  ok('toggle lives on the Total tab, off by default', ce() !== null && ce().checked === false);
  ce().checked = true; fire(ce(), 'change');
  ok('credit and EXP tiles vanish from Total; boss tiles stay',
     !titles().some(t => t.startsWith('Shell Credit') || t.startsWith('Resonator EXP')) &&
     titles().some(t => t.startsWith('Elegy Tacet Core')));
  ok('goal cards drop their credit/EXP tiles too',
     ![...d.querySelectorAll('.goal[data-g="0"] .tile')]
       .some(t => (t.getAttribute('title') || '').startsWith('Shell Credit')));
  ok('waveplate breakdown loses the sim/credit runs',
     !(d.querySelector('.goal[data-g="0"] .ready').getAttribute('title') || '').includes('sims') &&
     (d.querySelector('.goal[data-g="0"] .ready').getAttribute('title') || '').includes('boss ≈'));
  ok('setting persists in the save',
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).skipCE === true);
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Farm next'), 'click');
  ok('Farm next: today’s plan drops the EXP/credit simulation runs',
     [...d.querySelectorAll('#summary .today .run .rname')].length > 0 &&
     ![...d.querySelectorAll('#summary .today .run .rname')].some(r => /simulation/i.test(r.textContent)) &&
     ![...d.querySelectorAll('#summary .tile')]
       .some(t => (t.getAttribute('title') || '').startsWith('Shell Credit')));
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Total'), 'click');
  ce().checked = false; fire(ce(), 'change');
  ok('unticking restores the credit tile',
     titles().some(t => t.startsWith('Shell Credit')));
}

// ── material tooltips name who needs each item ──
{
  const tileBy = pre => [...d.querySelectorAll('#summary .tile')]
    .find(t => (t.getAttribute('title') || '').startsWith(pre));
  ok('shared weekly names both users in queue order',
     tileBy("Sentinel's Dagger").getAttribute('title').includes('needed by Jinhsi, Phoebe'));
  ok('single-user material names only its goal',
     tileBy('Elegy Tacet Core').getAttribute('title').includes('needed by Jinhsi') &&
     !tileBy('Elegy Tacet Core').getAttribute('title').includes('Phoebe'));
}

// ── crafting applies to the cards (Total-tab synth toggle), reserved tiers kept ──
{
  w.eval(`state.inv.howler0 = 99999; save(); render();`);   // on the Total tab
  const cardTile = pre => [...d.querySelectorAll('.goal[data-g="0"] .tile')]
    .find(t => (t.getAttribute('title') || '').startsWith(pre));
  ok('card crafts higher tiers out of tier-0 surplus',
     cardTile('FF Howler Core').classList.contains('done') &&
     cardTile('FF Howler Core').getAttribute('title').includes('covered'));
  const chk = () => d.querySelector('#synthChk');   // lives on the Total tab now
  chk().checked = false; fire(chk(), 'change');
  ok('synth off: the card shows the raw deficit again',
     !cardTile('FF Howler Core').classList.contains('done'));
  chk().checked = true; fire(chk(), 'change');
  ok('synth back on restores the crafted view', cardTile('FF Howler Core').classList.contains('done'));
  w.eval(`delete state.inv.howler0; save(); render();`);
}

// totals are ordered by queue priority: P1 Jinhsi's boss mat precedes P2 Phoebe's precedes P3 Suisui's
{
  const titles = [...d.querySelectorAll('#summary .tile')].map(t => t.getAttribute('title'));
  const at = s => titles.findIndex(t => t.startsWith(s));
  ok('totals ordered by priority queue',
     at('Shell Credit') === 0 && at('Elegy Tacet Core') > -1 &&
     at('Elegy Tacet Core') < at('Cleansing Conch') && at('Cleansing Conch') < at("Solidarity's Loneflame"));
}

// pooled EXP tiles use the max-tier item icon of their type (override map)
{
  const src = t => t && t.querySelector('img.__ico').getAttribute('src');
  const tiles = [...d.querySelectorAll('#summary .tile')];
  ok('Resonator EXP tile shows Premium Resonance Potion icon',
     src(tiles.find(t => t.title.startsWith('Resonator EXP'))) === 'images/materials/premium_resonance_potion_icon.png');
}

// element accent: cards expose --acc (element for chars, steel for weapons)
ok('char cards carry their element accent',
   (d.querySelector('.goal[data-g="0"]').getAttribute('style') || '').includes('--acc:var(--spectro)') &&
   (d.querySelector('.goal[data-g="2"]').getAttribute('style') || '').includes('--acc:var(--glacio)'));

// ── edit pop-up: Jinhsi current level 1 → 50✦ (ord 6), live apply ──
const modal = () => d.querySelector('#modalWrap');
const mbox = () => d.querySelector('#modalBox');
ok('pop-up hidden at boot', modal().hidden === true);
fire(d.querySelector('button[data-act="edit"][data-g="0"]'), 'click');
ok('✎ opens the edit pop-up', modal().hidden === false && mbox().textContent.includes('Jinhsi'));
const matsBefore = d.querySelector('.goal[data-g="0"] .goal-mats').textContent;
const lvlSel = mbox().querySelector('select[data-g="0"][data-side="cur"][data-f="ord"]');
lvlSel.value = '6'; fire(lvlSel, 'change');
ok('live apply: card meta updates while pop-up stays open',
   modal().hidden === false && d.querySelector('#goals .gmeta').textContent.includes('Lv 50 ✦ → Lv 90'));
ok('live apply: card materials re-render', d.querySelector('.goal[data-g="0"] .goal-mats').textContent !== matsBefore);
ok('totals shrink after raising current', d.querySelector('#summary .tile[title*="5,409,900"]') === null);

// cur > tgt clamping: set current skill above target, target must follow
const s0cur = mbox().querySelector('select[data-g="0"][data-side="cur"][data-f="s0"]');
s0cur.value = '10'; fire(s0cur, 'change');
ok('target skill clamped up to current',
   mbox().querySelector('select[data-g="0"][data-side="tgt"][data-f="s0"]').value === '10');
ok('card mini tree shows clamped skill', d.querySelector('.goal[data-g="0"] .mini .sk').textContent === '10→10');

// Esc closes (listener is on document)
d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
ok('Esc closes the pop-up', modal().hidden === true);

// ── reorder: move Phoebe (index 1) up ──
fire(d.querySelector('button[data-act="up"][data-g="1"]'), 'click');
ok('Phoebe now first', texts('.gname')[0].startsWith('Phoebe'));
ok('first up-button disabled', d.querySelector('button[data-act="up"][data-g="0"]').disabled === true);

// ── remove + re-add ──
fire(d.querySelector('button[data-act="del"][data-g="2"]'), 'click'); // remove Suisui
ok('goal removed', d.querySelectorAll('.goal').length === 2);
// ── add-goal palette: fuzzy search over the whole catalog ──
fire(d.querySelector('#btnAdd'), 'click');
ok('palette opens from the toolbar button', d.querySelector('#palWrap').hidden === false);
ok('empty query lists all un-queued chars + all weapons',
   d.querySelectorAll('#palList .pal-item').length ===
   w.eval('Object.keys(GAME.characters).length + Object.keys(GAME.weapons).length') - 2); // Pho + Jin queued

// grouping: 5★ chars · 4★ chars · 5★ weapons · 4★ weapons, faint rarity tint per row
{
  const items = [...d.querySelectorAll('#palList .pal-item')];
  const tags = items.map(x => x.querySelector('.tag').textContent);
  const lastCharIdx = tags.map(t => t.includes('char')).lastIndexOf(true);
  const firstWpnIdx = tags.findIndex(t => t.includes('weapon'));
  const last5CharIdx = tags.map(t => t === '5★ char').lastIndexOf(true);
  const first4CharIdx = tags.findIndex(t => t === '4★ char');
  ok('groups: chars before weapons, 5★ chars before 4★',
     firstWpnIdx > lastCharIdx && first4CharIdx > last5CharIdx && last5CharIdx > -1);
  ok('rows carry faint rarity tints', items[0].classList.contains('r5') &&
     items[first4CharIdx].classList.contains('r4'));
}
const palIn = d.querySelector('#palIn');
palIn.value = 'suisui'; fire(palIn, 'input');
fire([...d.querySelectorAll('#palList .pal-item')].find(x => x.textContent.includes('Suisui')), 'click');
ok('goal re-added at end via search',
   texts('.gname')[2].startsWith('Suisui') && d.querySelector('#palWrap').hidden === true);

// already-queued characters are hidden from results
fire(d.querySelector('#btnAdd'), 'click');
palIn.value = 'jinhsi'; fire(palIn, 'input');
ok('queued chars hidden from results',
   ![...d.querySelectorAll('#palList .pal-item')].some(x => x.textContent.includes('Jinhsi')));
d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

// Ctrl+K opens; subsequence fuzzy ranks sensibly; Esc closes
d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'k', ctrlKey:true, bubbles:true}));
ok('Ctrl+K opens the palette', d.querySelector('#palWrap').hidden === false);
palIn.value = 'aoh'; fire(palIn, 'input');
{ // subsequence matching spans word boundaries; tighter match ranks first
  const hits = texts('#palList .pal-item');
  ok('subsequence fuzzy: "aoh" → Azure Oath first (tightest match)',
     hits[0].includes('Azure Oath'));
  ok('subsequence fuzzy: "aoh" still surfaces Ages of Harvest',
     hits.some(t => t.includes('Ages of Harvest')));
}
d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
ok('Esc closes the palette', d.querySelector('#palWrap').hidden === true);

// ── right-click / Shift+Enter add a goal ALREADY BUILT ──
{
  const goalOf = name => w.eval(`JSON.stringify(state.goals.concat(state.done).find(g =>
    (g.char && GAME.characters[g.char].name === ${JSON.stringify(name)}) ||
    (g.weapon && GAME.weapons[g.weapon].name === ${JSON.stringify(name)})))`);
  const inDone = name => w.eval(`state.done.some(g =>
    (g.char && GAME.characters[g.char].name === ${JSON.stringify(name)}) ||
    (g.weapon && GAME.weapons[g.weapon].name === ${JSON.stringify(name)}))`);
  ok('the palette advertises the already-built add', d.querySelector('#palHint').hidden === false &&
     /right-click/.test(d.querySelector('#palHint').textContent) &&
     /already built/.test(d.querySelector('#palHint').textContent));

  // baseline: a plain click adds an UNBUILT goal from the rarity template
  fire(d.querySelector('#btnAdd'), 'click');
  palIn.value = 'changli'; fire(palIn, 'input');
  fire([...d.querySelectorAll('#palList .pal-item')].find(x => x.textContent.includes('Changli')), 'click');
  const changli = JSON.parse(goalOf('Changli'));
  ok('a plain click adds from the template, at Lv 1',
     changli.tgt.skills.join() === '6,6,6,6,6' && changli.cur.ord === 0 && changli.cur.skills.join() === '1,1,1,1,1');

  // right-click: the same template target, but the build is already DONE
  fire(d.querySelector('#btnAdd'), 'click');
  palIn.value = 'camellya'; fire(palIn, 'input');
  [...d.querySelectorAll('#palList .pal-item')].find(x => x.textContent.includes('Camellya'))
    .dispatchEvent(new w.MouseEvent('contextmenu', {bubbles:true, cancelable:true}));
  const cam = JSON.parse(goalOf('Camellya'));
  ok('right-click adds the character already levelled to its template target',
     d.querySelector('#palWrap').hidden === true &&
     cam.cur.ord === cam.tgt.ord && cam.cur.skills.join() === cam.tgt.skills.join());
  ok('…with every planned node OWNED (not just planned)',
     cam.nodes.every(row => row.every(v => v === 0 || v === 2)) &&
     cam.nodes.some(row => row.some(v => v === 2)));
  ok('…so it costs nothing and lands straight on the Completed tab, not the queue',
     w.eval(`Object.keys(costForGoal(state.done.find(g => g.char === 'camellya'))).length`) === 0 &&
     inDone('Camellya') === true &&
     ![...d.querySelectorAll('#goals .gname')].some(n => n.textContent.includes('Camellya')));

  // weapons come in maxed the same way (they already target Lv90)
  fire(d.querySelector('#btnAdd'), 'click');
  palIn.value = 'stringmaster'; fire(palIn, 'input');
  [...d.querySelectorAll('#palList .pal-item')].find(x => x.textContent.includes('Stringmaster'))
    .dispatchEvent(new w.MouseEvent('contextmenu', {bubbles:true, cancelable:true}));
  const sm = JSON.parse(goalOf('Stringmaster'));
  ok('right-click adds a weapon at Lv 90, already built and completed',
     sm.cur.ord === 13 && sm.tgt.ord === 13 && inDone('Stringmaster') === true);

  // Shift+Enter is the keyboard equivalent
  fire(d.querySelector('#btnAdd'), 'click');
  palIn.value = 'zani'; fire(palIn, 'input');
  palIn.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Enter', shiftKey:true, bubbles:true}));
  const zani = JSON.parse(goalOf('Zani'));
  ok('Shift+Enter adds it already built too', zani.cur.ord === zani.tgt.ord && inDone('Zani') === true);

  // pick modes have no "already built" concept
  w.eval(`openPal({mode:'slot', t:0, s:0})`);
  ok('the hint hides in team-pick mode', d.querySelector('#palHint').hidden === true);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

  w.eval(`state.goals = state.goals.filter(g => !g.weapon && (!g.char ||
    !['Changli','Camellya','Zani'].includes(GAME.characters[g.char].name)));
          state.done = []; save(); render();`);
  ok('scratch goals removed for the rest of the suite', texts('.gname').length === 3);
}

// helper: open palette, type a query, Enter-add the top hit
const palAdd = q => {
  fire(d.querySelector('#btnAdd'), 'click');
  const p = d.querySelector('#palIn');
  p.value = q; fire(p, 'input');
  p.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
};

// ── inventory lives ONLY in the pop-up now; the Inventory tab is gone ──
{
  ok('no Inventory tab — Total / Farm next / Completed only',
     [...d.querySelectorAll('#tabs button')].map(b => b.textContent.replace(/ \(\d+\)$/, '')).join(',') ===
       'Total,Farm next,Completed');
  w.eval('openInv()');
  const invTile = name => [...d.querySelectorAll('#invGrid .itile')]
    .find(t => (t.getAttribute('title') || '') === name);
  ok('the pop-up lists the full catalog as quantity tiles',
     d.querySelectorAll('#invGrid .iqty').length > 60 &&
     invTile('Roaring Rock Fist') !== undefined && invTile('Premium Resonance Potion') !== undefined);
  ok('pop-up tiles carry the plain name only — no need/left/covered text',
     invTile('Elegy Tacet Core').getAttribute('title') === 'Elegy Tacet Core' &&
     !/needed|missing|covered|not needed/.test(invTile('Cleansing Conch').getAttribute('title')));
  ok('the pop-up has no Craft 3→1 or Hide un-needed toggles',
     d.querySelector('#invWrap #isynthChk') === null && d.querySelector('#invWrap #ihideChk') === null);
  // stock 100 premium potions → exp4 = 100 (feeds the Resonator EXP pool)
  const prem = invTile('Premium Resonance Potion').querySelector('.iqty');
  prem.value = '100'; fire(prem, 'change');
  ok('typing a count on a tile saves it immediately', w.eval('state.inv.exp4') === 100);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));   // close → apply everywhere
  ok('closing the pop-up returns to the summary', d.querySelector('#invWrap').hidden === true);
}

// the Craft 3→1 toggle moved to the Total tab (beside Ignore credits & EXP)
{
  const synth = () => d.querySelector('#synthChk');
  ok('Craft 3→1 toggle now lives on the Total tab, on by default',
     synth() !== null && synth().checked === true);
  synth().checked = false; fire(synth(), 'change');
  ok('turning synth off persists to the save',
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).synth === false);
}

// ── Farm next tab: today's plan, then the no-waveplate materials ──
fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Farm next'), 'click');
ok('the per-goal walk rows are gone (they just restated the Ledger order)',
   d.querySelectorAll('#summary .goalstat').length === 0);
ok('the tab leads with today’s plan, then the free-farm section',
   d.querySelector('#summary .today') !== null &&
   d.querySelector('#summary .freefarm') !== null &&
   d.querySelector('#summary').firstElementChild.classList.contains('today'));
ok('free-farm groups by category, like the inventory',
   [...d.querySelectorAll('#summary .freefarm .ffcat')].map(c => c.textContent).join(',')
     === 'Specialty,Enemy Drops');
ok('free-farm lists ONLY no-waveplate materials (no boss/weekly/forgery/credits/EXP)', (() => {
   const tiles = [...d.querySelectorAll('#summary .freefarm .tile')];
   return tiles.length > 0 && tiles.every(t => w.eval(
     `isOverworld(MAT_ID_BY_NAME[${JSON.stringify((t.getAttribute('title') || '').split(' — ')[0])}]) === true`));
})());
ok('free-farm tiles carry the deficit and open the farm pop-up on click',
   [...d.querySelectorAll('#summary .freefarm .tile')]
     .every(t => /click to log drops/.test(t.getAttribute('title') || '')));

// ── today's plan: the daily budget split into whole runs ──
{
  const runs = () => [...d.querySelectorAll('#summary .today .run')];
  ok('the tab leads with today’s plan', d.querySelector('#summary .today') !== null &&
     d.querySelector('#summary').firstElementChild.classList.contains('today') && runs().length > 0);
  ok('the header shows what the plan spends of the daily budget, iconized', (() => {
     const b = d.querySelector('#summary .today-h .budget');
     return /\d+ \/ 240$/.test(b.textContent.trim()) && b.querySelector('.wp-ico') !== null; })());
  ok('every run names an activity, a run count, a yield and an iconized plate cost',
     runs().every(r => r.querySelector('.rname').textContent.length > 0 &&
       /^×\d+$/.test(r.querySelector('.x').textContent) &&
       r.querySelector('.gain').textContent.startsWith('≈') &&
       /^[\d,]+$/.test(r.querySelector('.plates').textContent) &&
       r.querySelector('.plates .wp-ico') !== null));
  ok('run rows carry the activity’s icon', runs().every(r => r.querySelector('.ico-wrap img') !== null));
  ok('the plan never overspends the budget',
     runs().reduce((s, r) => s + +r.querySelector('.plates').textContent.replace(/[^\d]/g, ''), 0) <= 240);
  ok('a spare-plates / cap / overworld note explains the leftovers',
     d.querySelector('#summary .today-f') === null ||
     d.querySelector('#summary .today-f').textContent.length > 0);
}

// ── persistence round-trip ──
const saved = JSON.parse(w.localStorage.getItem('wuwa-planner-v1'));
ok('state persisted to localStorage', saved && saved.goals.length === 3 && saved.inv.exp4 === 100);
ok('persisted order Phoebe first', saved.goals[0].char === 'phoebe');
ok('synth=off persisted', saved.synth === false);

// reload in a fresh DOM with same storage contents
const dom2 = new JSDOM(html, {runScripts:'dangerously', url:'https://localhost/'});
dom2.window.localStorage.setItem('wuwa-planner-v1', JSON.stringify(saved));
// re-run scripts against pre-seeded storage: third DOM
const dom3 = new JSDOM(html, {runScripts:'outside-only', url:'https://localhost/'});
dom3.window.localStorage.setItem('wuwa-planner-v1', JSON.stringify(saved));
dom3.window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n'));
ok('reload restores goal order & inventory',
   [...dom3.window.document.querySelectorAll('.gname')][0].textContent.startsWith('Phoebe') &&
   JSON.parse(dom3.window.localStorage.getItem('wuwa-planner-v1')).inv.exp4 === 100);

// sanitize hardening: corrupt storage falls back cleanly
const dom4 = new JSDOM(html, {runScripts:'outside-only', url:'https://localhost/'});
dom4.window.localStorage.setItem('wuwa-planner-v1', '{"goals":[{"char":"nope"},{"char":"jinhsi","cur":{"ord":99,"skills":"x"},"tgt":{"ord":-5}}],"inv":{"hack":9,"exp4":-3,"credits":"12.9"}}');
dom4.window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n'));
const d4 = dom4.window.document;
ok('corrupt save: unknown char dropped, valid char kept', d4.querySelectorAll('.goal').length === 1);
ok('corrupt save: ords clamped, tgt ≥ cur (maxed → just the level)',
   d4.querySelector('#goals .gmeta').textContent.includes('Lv 90') &&
   !d4.querySelector('#goals .gmeta').textContent.includes('→'));
const inv4 = JSON.parse(dom4.window.localStorage.getItem('wuwa-planner-v1') || '{}').inv || {};
ok('corrupt save: bad inventory scrubbed', !('hack' in inv4) && !('exp4' in inv4) && inv4.credits === 12);

// ── icons ──
{
  reset();
  // convention: character avatar + material rows resolve to slugged filenames
  const av = d.querySelector('.goal[data-g="0"] .avatar img.__ico');
  ok('avatar icon uses slug (Jinhsi leads the default queue)', av && av.getAttribute('src') === 'images/characters/jinhsi_icon.png');
  const srcs = [...d.querySelectorAll('#summary .ico-wrap img.__ico')].map(im => im.getAttribute('src'));
  ok('material icons rendered in summary', srcs.length > 0 && srcs.every(s => s.startsWith('images/materials/') && s.includes('_icon.')));
  ok("apostrophes dropped in slugs (Sentinel's Dagger)",
     [...d.querySelectorAll('img.__ico')].some(im => im.getAttribute('src') === 'images/materials/sentinels_dagger_icon.png'));

  // fallback chain: error → .webp → .jpg → hidden img + visible dot
  const im = d.querySelector('#summary .ico-wrap img.__ico');
  fire(im, 'error');
  ok('1st failure retries .webp', im.getAttribute('src').endsWith('.webp'));
  fire(im, 'error');
  ok('2nd failure retries .jpg', im.getAttribute('src').endsWith('.jpg'));
  fire(im, 'error');
  ok('3rd failure hides img, reveals dot', im.hidden === true && im.nextElementSibling.hidden === false);

  // override map wins over slug
  w.eval("GAME.icons.overrides['Shell Credit'] = 'credits'; render();");
  ok('override filename respected',
     [...d.querySelectorAll('img.__ico')].some(x => x.getAttribute('src') === 'images/materials/credits.png'));
  w.eval("delete GAME.icons.overrides['Shell Credit']; render();");   // GAME is shared — undo the mutation
}

// ── card reordering: ▲▼ only; the main grid is no longer draggable ──
{
  reset();                                   // baseline order Jin,Pho,Sui
  const order = () => texts('.gname').map(t => t.slice(0,3)).join(',');
  ok('goal cards have no drag grip and are not draggable',
     d.querySelectorAll('#goals .grip').length === 0 &&
     [...d.querySelectorAll('#goals .goal')].every(c => c.getAttribute('draggable') !== 'true'));
  ok('baseline order', order() === 'Jin,Pho,Sui');
  // ▼ on the first card
  fire(d.querySelector('button[data-act="down"][data-g="0"]'), 'click');
  ok('▼ moves the top card down', order() === 'Pho,Jin,Sui');
  // ▲ on the last card
  fire(d.querySelector('button[data-act="up"][data-g="2"]'), 'click');
  ok('▲ moves a card up', order() === 'Pho,Sui,Jin');
  ok('edge arrows disabled (first ▲, last ▼)',
     d.querySelector('button[data-act="up"][data-g="0"]').disabled === true &&
     d.querySelector('button[data-act="down"][data-g="2"]').disabled === true);
  ok('reordered queue persisted',
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).goals.map(g => g.char).join(',') === 'phoebe,suisui,jinhsi');
}

// ── level label: "cur → tgt" while building, just the level once maxed ──
{
  reset();
  const meta = i => d.querySelector(`.goal[data-g="${i}"] .gmeta`).textContent;
  ok('a building goal shows the cur → tgt range', /Lv 1 → Lv 90/.test(meta(0)));
  w.eval(`state.goals[0].cur.ord = state.goals[0].tgt.ord; save(); render();`);
  ok('a goal at its target level shows just the level, no arrow',
     /Lv 90$/.test(meta(0).trim()) && !meta(0).includes('→'));
}

// ── acting on today's plan: click a run to log drops; ✓ claims the weekly ──
{
  reset();
  const farmNext = () => fire([...d.querySelectorAll('#tabs button')]
    .find(b => b.textContent === 'Farm next'), 'click');
  farmNext();
  const runs = () => [...d.querySelectorAll('#summary .today .run')];
  const runOf = kind => runs().find(r => w.eval(`RUNS[${+r.dataset.run}].kind`) === kind);
  const wkLine = () => d.querySelector('#summary .wk-line').textContent;

  ok('a fresh week shows all 3 weekly claims left', /3 \/ 3 left this week/.test(wkLine()));
  ok('only the weekly run carries a ✓ (its drop is deterministic)',
     runOf('weekly').querySelector('[data-claim]') !== null &&
     runs().filter(r => r.querySelector('[data-claim]')).length === 1);
  ok('the EXP-sim run has no ✓ (its yield is only an average)',
     runOf('exp') !== undefined && runOf('exp').querySelector('[data-claim]') === null);

  // (A) clicking a non-weekly run opens the farm pop-up so you log REAL drops.
  // The EXP sim opens the potion ladder — the only way those runs can be logged.
  fire(runOf('exp'), 'click');
  ok('clicking the EXP-sim run opens the farm pop-up on the potion ladder',
     d.querySelector('#farmWrap').hidden === false &&
     w.eval('JSON.stringify(FARM) === JSON.stringify(GAME.expItems.map(x => x.id))'));
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

  // (B) the weekly ✓ credits the exact yield and spends the claims
  farmNext();
  const wkRun = runOf('weekly');
  const rd = f => w.eval(`RUNS[${+wkRun.dataset.run}].${f}`);
  const wkId = rd('id'), wkYield = rd('yield'), wkCount = rd('runs');
  const held = w.eval(`state.inv[${JSON.stringify(wkId)}] || 0`);
  fire(wkRun.querySelector('[data-claim]'), 'click');
  ok('✓ credits exactly the weekly yield (deterministic, not an estimate)',
     w.eval(`state.inv[${JSON.stringify(wkId)}]`) === held + wkYield &&
     wkYield === wkCount * w.eval('GAME.waveplates.weekly.drops'));
  ok('…and spends that many of the 3 weekly claims',
     w.eval('state.week.used') === wkCount &&
     new RegExp(`${3 - wkCount} / 3 left this week`).test(wkLine()));
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true}));
  ok('claiming is undoable (materials and the claim count both roll back)',
     w.eval('state.week.used') === 0 &&
     w.eval(`(state.inv[${JSON.stringify(wkId)}] || 0)`) === held);

  // an exhausted week stops the plan suggesting weekly runs at all
  w.eval('state.week.used = 3; save(); render();');
  farmNext();
  ok('with all 3 claims spent, no weekly run is planned',
     runOf('weekly') === undefined && /0 \/ 3 left this week/.test(wkLine()));
  ok('…and the budget still books other activities', runs().length > 0);

  // the week auto-resets at the Monday-04:00 boundary
  ok('a stale week resets the claim count (Monday 04:00 rollover)', w.eval(`
    const stale = sanitizeWeek({start: weekStartMs(Date.now()) - 7 * 86400000, used: 3});
    stale.used === 0 && stale.start === weekStartMs(Date.now());`));
  ok('a current week keeps its count', w.eval(
    'sanitizeWeek({start: weekStartMs(Date.now()), used: 2}).used === 2'));
}

// ── forte node grid in the pop-up (2×5 matrix with column dependencies) ──
{
  reset();                                   // goal[1] = Phoebe, fresh→maxed default
  fire(d.querySelector('button[data-act="edit"][data-g="1"]'), 'click');
  const tree = mbox().querySelector('.ftree');
  ok('pop-up game view: 5 skill columns (+2 gutters) × (2 nodes + 2 selects)', tree &&
     tree.querySelectorAll('.node').length === 10 &&
     tree.querySelectorAll('.fcol:not(.gut)').length === 5 &&
     tree.querySelectorAll('.link').length === 5 &&
     tree.querySelectorAll('select').length === 10);
  ok('tree shape: 4 minors, 4 majors, 2 inherents',
     tree.querySelectorAll('.node.minor').length === 4 &&
     tree.querySelectorAll('.node.major').length === 4 &&
     tree.querySelectorAll('.node.inh').length === 2);
  ok('fresh→maxed default shows all planned', [...tree.querySelectorAll('.node')].every(n => n.classList.contains('plan')));

  const cell = (r, c) => mbox().querySelector(`.node[data-r="${r}"][data-c="${c}"]`);
  const saved = () => JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).goals[1];

  // cascade down: owning a top node (right-click) pulls its bottom node to owned
  fire(cell(1, 0), 'contextmenu');                 // top col0: plan → own
  let g1 = saved();
  ok('top→own cascades bottom→own', g1.nodes[1][0] === 2 && g1.nodes[0][0] === 2);
  ok('derived counts follow cascade', g1.cur.major === 1 && g1.cur.minor === 1);

  // left-click demotes owned → planned, then unplans; skipping the bottom clears the top
  fire(cell(0, 0), 'click');                       // bottom col0: own → planned
  g1 = saved();
  ok('left on owned demotes to planned (top follows down)', g1.nodes[0][0] === 1 && g1.nodes[1][0] === 1);
  fire(cell(0, 0), 'click');                       // bottom col0: planned → skip
  g1 = saved();
  ok('bottom→skip cascades top→skip', g1.nodes[0][0] === 0 && g1.nodes[1][0] === 0);
  ok('counts drop on both rows', g1.tgt.major === 3 && g1.tgt.minor === 3);

  // top can sit below bottom: bottom owned, top planned is legal
  fire(cell(0, 1), 'contextmenu');                 // bottom col1: plan → own
  g1 = saved();
  ok('bottom owned + top planned is legal', g1.nodes[0][1] === 2 && g1.nodes[1][1] === 1);

  // inherent ordering: Ⅱ owned pulls Ⅰ owned; skipping Ⅰ clears Ⅱ
  fire(cell(1, 2), 'dblclick');                    // Ⅱ: plan → own (double-click owns too)
  g1 = saved();
  ok('Passive Ⅱ owned requires Ⅰ owned', g1.cur.inh2 === 1 && g1.cur.inh1 === 1 && g1.nodes[0][2] === 2);
  fire(cell(0, 2), 'click'); fire(cell(0, 2), 'click');   // Ⅰ: own → planned → skip
  g1 = saved();
  ok('skipping Ⅰ clears Ⅱ', g1.nodes[0][2] === 0 && g1.nodes[1][2] === 0 && g1.tgt.inh2 === 0);

  // connector reflects the pair's state (colored by the upper node)
  const links = [...mbox().querySelectorAll('.link')];
  ok('column connector colored by top state',
     !links[0].classList.contains('plan') && !links[0].classList.contains('own') /* col0 skipped */ &&
     links[1].classList.contains('plan') /* col1: bottom owned, top planned */);

  // the read-only card mini tree mirrors the pop-up edits live
  // state now: col0 skipped(2), col1 bottom own + top plan, col2 skipped(2), cols 3-4 planned(4)
  ok('card mini tree mirrors pop-up edits',
     d.querySelectorAll('.goal[data-g="1"] .mini .node.own').length === 1 &&
     d.querySelectorAll('.goal[data-g="1"] .mini .node.plan').length === 5);

  // backdrop click closes
  fire(d.querySelector('#modalWrap'), 'click');
  ok('backdrop click closes the pop-up', d.querySelector('#modalWrap').hidden === true);
}

// ── forte stat payoff line in the edit pop-up (editor only, live) ──
{
  reset();
  // Jinhsi has node data (critRate + atk); default target plans every node
  fire(d.querySelector('button[data-act="edit"][data-g="0"]'), 'click');
  const line = () => mbox().querySelector('.fstat');
  ok('the editor shows a forte stat line for a character with node data', line() !== null);
  ok('the full planned build totals both stats',
     /\+8%\s*Crit\. Rate/.test(line().textContent) && /\+12%\s*ATK/.test(line().textContent));
  ok('the card itself carries no stat line (editor only)',
     d.querySelector('#goals .fstat') === null);

  // live: skipping every stat node empties the total, and the line stays
  w.eval(`{ const g = state.goals[0];
    for(const c of [0,1,3,4]){ g.nodes[0][c] = 0; g.nodes[1][c] = 0; }
    syncNodeCounts(g); save(); render(); }`);
  ok('skipping all stat nodes shows the empty-state, line does not vanish',
     line() !== null && /no stat nodes planned/.test(line().textContent));

  // re-owning one crit column updates live: 1.2 + 2.8 = 4%
  fire(mbox().querySelector('.node[data-r="0"][data-c="0"]'), 'contextmenu');   // lower col0 → owned
  fire(mbox().querySelector('.node[data-r="1"][data-c="0"]'), 'contextmenu');   // upper col0 → owned
  ok('re-owning one crit column recomputes to +4% live',
     /\+4%\s*Crit\. Rate/.test(line().textContent) && !/ATK/.test(line().textContent));
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

  // a character with no datamined node data shows no line at all
  w.eval(`state.goals.push(newGoal('suisui', false, state.defaults)); save(); render();`);
  const si = w.eval(`state.goals.findIndex(g => g.char === 'suisui')`);
  fire(d.querySelector(`button[data-act="edit"][data-g="${si}"]`), 'click');
  ok('a post-3.1 character (no node data) shows no stat line', mbox().querySelector('.fstat') === null);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

  // weapon goals never show it
  reset();
  w.eval(`state.goals.push(newWpnGoal('agesOfHarvest', false)); save(); render();`);
  const wi = w.eval('state.goals.length - 1');
  fire(d.querySelector(`button[data-act="edit"][data-g="${wi}"]`), 'click');
  ok('weapon goals show no forte stat line', mbox().querySelector('.fstat') === null);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
}

// ── material hover popover: needers shown as avatar chips ──
{
  reset();
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Total'), 'click');
  const pop = () => d.querySelector('#tipPop');
  const tileBy = pre => [...d.querySelectorAll('#summary .tile')]
    .find(t => (t.getAttribute('title') || '').startsWith(pre));
  ok('the popover is hidden until a tile is hovered', pop().hidden === true);

  // a shared material: both needers as chips with their avatars
  const dagger = tileBy("Sentinel's Dagger");   // Jinhsi + Phoebe weekly
  fire(dagger, 'mouseenter');
  ok('hover opens the popover', pop().hidden === false);
  ok('it is a real fixed overlay', w.getComputedStyle(pop()).position === 'fixed');
  const head = () => pop().querySelector('.tip-h').textContent;
  ok('owning none reads as just the amount needed (no "0/12")',
     head() === "Sentinel's Dagger — 12" &&
     !head().includes('needed by') && !head().includes('click to log'));
  const chips = () => [...pop().querySelectorAll('.tip-chip')].map(c => ({
    name: c.querySelector('span').textContent,
    qty: c.querySelector('.tip-q').textContent,
    ok: c.classList.contains('ok'),
  }));
  ok('one chip per needer, in queue order, each with a name',
     chips().map(c => c.name).join(',') === 'Jinhsi,Phoebe');
  ok('a needer owning none shows just its need, not "0/6"',
     chips().map(c => c.qty).join(',') === '6,6' && chips().every(c => !c.ok));

  // stock 6 → the walk gives them all to P1 (queue order), so Jinhsi is covered
  // and Phoebe still needs its full share. Same allocation the cards use.
  fire(dagger, 'mouseleave');
  w.eval(`state.inv["wk:Sentinel's Dagger"] = 6; save(); render();`);
  const dagger2 = tileBy("Sentinel's Dagger");
  fire(dagger2, 'mouseenter');
  ok('a fully-covered needer shows a ✓', chips()[0].qty === '✓' && chips()[0].ok === true);
  ok('…the next goal in the queue got none, so it shows just its need',
     chips()[1].qty === '6' && chips()[1].ok === false);
  ok('a part-way header shows own/needed', head() === "Sentinel's Dagger — 6/12");

  // part-way through → the own/needed ratio (render() already dropped the tip)
  w.eval(`state.inv["boss:Elegy Tacet Core"] = 10; save(); render();`);   // Jinhsi needs 46
  const elegyP = tileBy('Elegy Tacet Core');
  fire(elegyP, 'mouseenter');
  ok('part-way through, a chip shows own/needed', chips()[0].qty === '10/46');
  fire(elegyP, 'mouseleave');

  w.eval('state.inv = {}; save(); render();');            // back to an empty stock
  // re-renders rebuilt the tiles, so grab a live node for the rest
  const dagger3 = tileBy("Sentinel's Dagger");
  const heldTitle = dagger3.getAttribute('title');
  fire(dagger3, 'mouseenter');
  ok('each chip carries the character’s avatar image (not just text)',
     [...pop().querySelectorAll('.tip-chip .tip-av')].map(im => im.getAttribute('src')).join(',') ===
       'images/characters/jinhsi_icon.png,images/characters/phoebe_icon.png');
  ok('the native title is suppressed while the popover is up (no double tooltip)',
     dagger3.getAttribute('title') === null);
  fire(dagger3, 'mouseleave');
  ok('leaving hides the popover and restores the native title',
     pop().hidden === true && dagger3.getAttribute('title') === heldTitle);

  // a single-needer material shows just its one chip. Capture the element
  // first: mouseenter suppresses the title, so it can't be re-found by title.
  const elegy = tileBy('Elegy Tacet Core');         // Jinhsi only
  fire(elegy, 'mouseenter');
  ok('a single-user material shows one chip, owning none → just the need',
     pop().querySelectorAll('.tip-chip').length === 1 &&
     pop().querySelector('.tip-chip span').textContent === 'Jinhsi' &&
     pop().querySelector('.tip-chip .tip-q').textContent === '46');
  fire(elegy, 'mouseleave');

  // a weapon needer renders its avatar from the weapons folder
  w.eval(`state.goals.push(newWpnGoal('agesOfHarvest', false)); save(); render();`);
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Total'), 'click');
  const credit = tileBy('Shell Credit');        // needed by every goal, incl. the weapon
  fire(credit, 'mouseenter');
  ok('a weapon needer shows a weapon-folder avatar chip',
     [...pop().querySelectorAll('.tip-chip .tip-av')]
       .some(im => im.getAttribute('src').startsWith('images/weapons/')));
  ok('…and the weapon appears alongside the character needers',
     [...pop().querySelectorAll('.tip-chip')].some(c => c.textContent.includes('Ages of Harvest')) &&
     pop().querySelectorAll('.tip-chip').length >= 4);
  fire(credit, 'mouseleave');

  // re-render clears any stale popover
  fire(tileBy('Shell Credit'), 'mouseenter');
  w.eval('render()');
  ok('a re-render hides a lingering popover', pop().hidden === true);
}

// ── save migrations → matrix ──
{
  const run = payload => {
    const dm = new JSDOM(html, {runScripts:'outside-only', url:'https://localhost/'});
    dm.window.localStorage.setItem('wuwa-planner-v1', JSON.stringify(payload));
    dm.window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n'));
    return {saved: JSON.parse(dm.window.localStorage.getItem('wuwa-planner-v1')).goals[0], doc: dm.window.document};
  };
  // v1 count-based, with counts that violate the new rule (3 majors, 1 minor)
  const v1 = run({goals:[{char:'jinhsi',
    cur:{ord:6, skills:[6,6,6,6,6], inh:2, minor:1, major:3},
    tgt:{ord:13, skills:[10,10,10,10,10], inh:2, minor:4, major:4}, open:true}], inv:{}, synth:true, tab:'total'});
  ok('v1 migration: matrix built and repaired (minors raised under majors)',
     JSON.stringify(v1.saved.nodes) === JSON.stringify([[2,2,2,2,1],[2,2,2,2,1]]));
  ok('v1 migration: counts resynced to a legal state', v1.saved.cur.minor === 3 && v1.saved.cur.major === 3);
  // v2 grid format {minor,major,inh}, also with a violation (major owned over skipped minor)
  const v2 = run({goals:[{char:'phoebe', cur:{ord:0}, tgt:{ord:13},
    nodes:{minor:[0,1,0,0], major:[2,0,0,0], inh:[0,2]}, open:true}], inv:{}, synth:true, tab:'total'});
  ok('v2 migration: violations repaired by raising lower cells',
     JSON.stringify(v2.saved.nodes) === JSON.stringify([[2,1,2,0,0],[2,0,2,0,0]]));
  ok('v2 migration: inherent ordering repaired', v2.saved.cur.inh1 === 1 && v2.saved.cur.inh2 === 1);
  // repaired v2 state [[2,1,2,0,0],[2,0,2,0,0]] → 4 owned + 1 planned on the card mini tree
  ok('migrated grid renders repaired states',
     v2.doc.querySelectorAll('.mini .node.own').length === 4 &&
     v2.doc.querySelectorAll('.mini .node.plan').length === 1);
}

// ── weapon goals ──
{
  reset();                                   // queue Jinhsi/Phoebe/Suisui; weapon appends at index 3
  palAdd('ages of harvest');
  ok('weapon goal appended via Enter', texts('.gname')[3] === 'Ages of Harvest');
  const card = d.querySelector('.goal[data-g="3"]');
  ok('weapon card: read-only, no mini tree (level lives in the meta line)',
     card.querySelector('.mini') === null && card.querySelectorAll('select').length === 0);
  ok('weapon card shows its materials as tiles', card.querySelector('.goal-mats .tiles') !== null);
  ok('weapon card carries the weapon accent', (card.getAttribute('style') || '').includes('--acc:var(--weapon)'));
  ok('weapon meta reads: carrier · type glyph · level — no rarity, no words',
     card.querySelector('.gmeta .ochip') !== null &&
     card.querySelector('.gmeta .rstar') === null &&        // the portrait's ground shows rarity
     card.querySelector('.gmeta .attr img.__ico').getAttribute('src') === 'images/attributes/broadblade_icon.png' &&
     !card.querySelector('.gmeta').textContent.includes('Broadblade') &&
     !card.querySelector('.gmeta').textContent.includes('★') &&
     card.querySelector('.gmeta .lvl').textContent.includes('Lv 1 → Lv 90'));
  ok('the priority number lost its P', card.querySelector('.prio').textContent === '4');
  ok('weapon avatar resolves in images/weapons/',
     card.querySelector('.avatar img.__ico').getAttribute('src') === 'images/weapons/ages_of_harvest_icon.png');

  // weapon pop-up: level row only; cur > tgt clamping still applies
  fire(d.querySelector('button[data-act="edit"][data-g="3"]'), 'click');
  ok('weapon pop-up: 2 level selects, no forte grid',
     mbox().querySelectorAll('select').length === 2 && mbox().querySelectorAll('.node').length === 0);
  const curSel = mbox().querySelector('select[data-side="cur"][data-f="ord"]');
  curSel.value = '13'; fire(curSel, 'change');
  ok('weapon target clamped up to current',
     mbox().querySelector('select[data-side="tgt"][data-f="ord"]').value === '13');
  ok('met target shows empty-mats note on the card',
     d.querySelector('.goal[data-g="3"]').textContent.includes('Nothing needed'));
  const curSel2 = mbox().querySelector('select[data-side="cur"][data-f="ord"]');
  curSel2.value = '0'; fire(curSel2, 'change');       // back to a full Lv1→90 plan
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

  // duplicates are allowed (multiple copies of the same weapon)
  palAdd('ages of harvest');
  ok('duplicate weapon goal allowed', texts('.gname').filter(t => t === 'Ages of Harvest').length === 2);
  // deleting the goal being edited closes the pop-up
  fire(d.querySelector('button[data-act="edit"][data-g="4"]'), 'click');
  fire(d.querySelector('button[data-act="del"][data-g="4"]'), 'click');
  ok('deleting the edited goal closes the pop-up', d.querySelector('#modalWrap').hidden === true);

  // beta badge rides on beta weapons
  palAdd('firstlight');
  ok('beta weapon carries the badge', d.querySelector('.goal[data-g="4"] .badge') !== null);
  fire(d.querySelector('button[data-act="del"][data-g="4"]'), 'click');

  // energy cores feed the Weapon EXP pool (separate from potions) — log via the pop-up
  w.eval('openInv()');
  const coreTile = [...d.querySelectorAll('#invGrid .itile')]
    .find(t => (t.getAttribute('title') || '') === 'Premium Energy Core');
  ok('energy cores appear in the inventory pop-up', coreTile !== undefined);
  const coreIn = coreTile.querySelector('.iqty');
  coreIn.value = '100'; fire(coreIn, 'change');       // 100×20k = 2,000,000 wexp
  ok('core count saves to the wexp pool (its own key, no potions set)',
     w.eval('state.inv.wexp4') === 100 && w.eval('state.inv.exp4 === undefined'));
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

  // Farm next accounts for weapon goals too
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Farm next'), 'click');
  ok('today’s plan still books runs with a weapon queued',
     d.querySelectorAll('#summary .today .run').length > 0);
  ok('the weapon’s overworld mats appear in the no-waveplate section',
     d.querySelectorAll('#summary .freefarm .tile').length > 0);

  // persistence round-trip includes the weapon goal
  const savedW = JSON.parse(w.localStorage.getItem('wuwa-planner-v1'));
  ok('weapon goal persisted', savedW.goals.some(g => g.weapon === 'agesOfHarvest') && savedW.inv.wexp4 === 100);

  // sanitize: unknown weapon dropped, ords clamped, tgt ≥ cur
  const domW = new JSDOM(html, {runScripts:'outside-only', url:'https://localhost/'});
  domW.window.localStorage.setItem('wuwa-planner-v1',
    '{"goals":[{"weapon":"nope"},{"weapon":"stonard","cur":{"ord":99},"tgt":{"ord":-2}},{"weapon":"stonard"}],"inv":{"wexp2":3.9}}');
  domW.window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n'));
  const dW = domW.window.document;
  ok('corrupt save: unknown weapon dropped, dup copies kept', dW.querySelectorAll('.goal').length === 2);
  ok('corrupt save: weapon ords clamped, tgt ≥ cur (maxed → just the level)',
     dW.querySelector('#goals .gmeta').textContent.includes('Lv 90') &&
     !dW.querySelector('#goals .gmeta').textContent.includes('→'));
  ok('corrupt save: core inventory floored',
     JSON.parse(domW.window.localStorage.getItem('wuwa-planner-v1')).inv.wexp2 === 3);
}

// ── inventory pop-up works with an empty queue; old tab:"left" saves migrate ──
{
  const domE = new JSDOM(html, {runScripts:'outside-only', url:'https://localhost/'});
  domE.window.localStorage.setItem('wuwa-planner-v1', '{"goals":[],"inv":{"exp4":5},"tab":"left"}');
  domE.window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n'));
  const dE = domE.window.document;
  ok('an old tab:"left" (Inventory tab) save migrates to Total',
     JSON.parse(domE.window.localStorage.getItem('wuwa-planner-v1')).tab === 'total');
  ok('empty queue shows the "add a goal" note on Total',
     dE.querySelector('#summary .empty') !== null);
  domE.window.eval('openInv()');
  ok('the inventory pop-up lists every material with no goals queued',
     dE.querySelectorAll('#invGrid .iqty').length > 60);
  ok('stock loads into the tiles with no goals queued',
     [...dE.querySelectorAll('#invGrid .iqty')].some(i => i.value === '5'));
  domE.window.eval('closeInv()');
  dE.querySelector('#btnOrder').dispatchEvent(new domE.window.Event('click', {bubbles:true}));
  ok('reorder pop-up on an empty queue shows a note, not rows',
     dE.querySelector('#ordWrap').hidden === false &&
     dE.querySelectorAll('#ordList .ord-item').length === 0 &&
     dE.querySelector('#ordList .empty') !== null);
}

// ── per-rarity default goals + Max button ──
{
  reset();
  palAdd('ages of harvest');                 // weapon at index 3 (this block edits it below)
  // 4★ default template: Lv80, forte 6, all 8 nodes + both passives planned
  palAdd('sanhua');
  const sCard = () => d.querySelector('.goal[data-g="4"]');
  ok('4★ default target: Lv 1 → Lv 80', sCard().textContent.includes('Lv 1 → Lv 80'));
  ok('4★ default: forte 6 on mini tree',
     [...sCard().querySelectorAll('.mini .sk')].every(s => s.textContent === '1→6'));
  ok('4★ default: all nodes + passives planned',
     sCard().querySelectorAll('.mini .node.plan').length === 10);

  // Max button: target → Lv90 / skills 10 / every node & passive planned
  fire(d.querySelector('button[data-act="edit"][data-g="4"]'), 'click');
  fire(mbox().querySelector('.node[data-r="1"][data-c="2"]'), 'click');   // skip passive Ⅱ first
  ok('passive Ⅱ skipped before max', sCard().querySelectorAll('.mini .node.plan').length === 9);
  fire(mbox().querySelector('[data-max]'), 'click');
  ok('max: level target 90', sCard().textContent.includes('Lv 1 → Lv 90'));
  ok('max: skills to 10', [...sCard().querySelectorAll('.mini .sk')].every(s => s.textContent === '1→10'));
  ok('max: every node & passive back to planned',
     sCard().querySelectorAll('.mini .node.plan').length === 10);
  ok('max: pop-up stays open, selects follow',
     d.querySelector('#modalWrap').hidden === false &&
     mbox().querySelector('select[data-side="tgt"][data-f="ord"]').value === '13');

  // editor is lean now: no bottom legend, no save-as-default (Templates owns that)
  ok('goal editor: no bottom legend, no save-as-default',
     mbox().querySelector('.ftree-legend') === null && mbox().querySelector('[data-setdef]') === null);

  /* ✓ Max goal: the build is DONE — the editor closes, the card flies out
     (.leaving), and only when the flight lands does the goal move to Completed.
     flushCompletion() is the app's own "land it now" (it also fires when a second
     goal is maxed mid-flight); the tests use it to skip the 380ms animation. */
  fire(mbox().querySelector('[data-maxgoal]'), 'click');
  ok('max goal: the editor closes and the card starts flying out',
     d.querySelector('#modalWrap').hidden === true &&
     sCard().classList.contains('leaving') &&
     w.eval('state.done.length') === 0);          // state untouched until it lands
  w.eval('flushCompletion()');
  const sanhua = () => JSON.parse(w.eval('JSON.stringify(state.done[0])'));
  ok('max goal: it lands on the Completed tab, current = target',
     w.eval('state.done.length') === 1 && sanhua().char === 'sanhua' &&
     sanhua().cur.ord === sanhua().tgt.ord &&
     sanhua().cur.skills.join() === sanhua().tgt.skills.join());
  ok('max goal: every planned node is now owned',
     sanhua().nodes.every(r => r.every(v => v === 0 || v === 2)) &&
     sanhua().nodes.some(r => r.some(v => v === 2)));
  ok('max goal: it costs nothing and left the queue',
     w.eval(`Object.keys(costForGoal(state.done[0])).length`) === 0 &&
     ![...d.querySelectorAll('#goals .gname')].some(n => n.textContent.includes('Sanhua')));
  ok('max goal: the Completed tab flags the arrival', /Completed \(1\)/.test(d.querySelector('#tabs').textContent));
  w.eval('doUndo()');
  ok('one Ctrl+Z restores the pre-max build in its queue slot',
     w.eval('state.done.length') === 0 &&
     w.eval(`state.goals[4].char`) === 'sanhua' &&
     w.eval(`state.goals[4].cur.ord`) === 0);     // back to Lv 1, not maxed
  fire(d.querySelector('button[data-act="del"][data-g="4"]'), 'click');   // remove sanhua
  // weapon pop-up keeps Max, and its Max goal completes the weapon the same way
  fire(d.querySelector('button[data-act="edit"][data-g="3"]'), 'click');
  ok('weapon pop-up keeps Max', mbox().querySelector('[data-max]') !== null);
  fire(mbox().querySelector('[data-maxgoal]'), 'click');
  w.eval('flushCompletion()');
  ok('weapon max goal: Lv 90 and straight to Completed',
     w.eval('state.done.length') === 1 && w.eval('state.done[0].weapon') === 'agesOfHarvest' &&
     w.eval('state.done[0].cur.ord') === 13);
  w.eval('doUndo()');                                 // back to a full plan for later blocks
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
}

// ── bulk skill ±1 buttons ──
{
  reset();
  palAdd('ages of harvest');                 // weapon at index 3 (checked for no bulk buttons below)
  fire(d.querySelector('button[data-act="edit"][data-g="1"]'), 'click');   // Phoebe: cur 1s, tgt 6s
  const val = (side, f) => mbox().querySelector(`select[data-side="${side}"][data-f="${f}"]`).value;
  const SK = ['s0','s1','s2','s3','s4'];
  ok('±1 gutters flank the grid (first and last columns)', (() => {
    const cols = [...mbox().querySelectorAll('.medit > .fcol')];
    return cols.length === 7 && cols[0].classList.contains('gut') && cols[6].classList.contains('gut') &&
           cols[0].querySelector('[data-bulk="cur-"]') !== null && cols[6].querySelector('[data-bulk="tgt+"]') !== null;
  })());
  fire(mbox().querySelector('[data-bulk="tgt+"]'), 'click');
  ok('bulk target +1 raises all five', SK.every(f => val('tgt', f) === '7'));
  fire(mbox().querySelector('[data-bulk="cur+"]'), 'click');
  ok('bulk current +1, mini tree follows',
     SK.every(f => val('cur', f) === '2') &&
     d.querySelector('.goal[data-g="1"] .mini .sk').textContent === '2→7');
  for(let i = 0; i < 6; i++) fire(mbox().querySelector('[data-bulk="tgt-"]'), 'click');
  ok('bulk target −1 drags current down at the floor',
     SK.every(f => val('tgt', f) === '1') && SK.every(f => val('cur', f) === '1'));
  for(let i = 0; i < 10; i++) fire(mbox().querySelector('[data-bulk="cur+"]'), 'click');
  ok('bulk current +1 caps at 10 and drags target up',
     SK.every(f => val('cur', f) === '10') && SK.every(f => val('tgt', f) === '10'));

  // per-skill ± pairs under both select rows
  ok('per-skill ± pairs: 2 rows × 5 columns × 2 buttons', mbox().querySelectorAll('[data-skc]').length === 20);
  fire(mbox().querySelector('[data-skc="0"][data-sks="tgt"][data-skd="-1"]'), 'click');
  ok('skill target −1 drags current down, only that column',
     val('tgt', 's0') === '9' && val('cur', 's0') === '9' && val('tgt', 's1') === '10');
  fire(mbox().querySelector('[data-skc="0"][data-sks="cur"][data-skd="1"]'), 'click');
  ok('skill current +1 drags target up', val('cur', 's0') === '10' && val('tgt', 's0') === '10');
  fire(mbox().querySelector('[data-skc="3"][data-sks="cur"][data-skd="-1"]'), 'click');
  ok('skill current −1 leaves target', val('cur', 's3') === '9' && val('tgt', 's3') === '10');
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  ok('weapon pop-up has no bulk buttons', (() => {
    fire(d.querySelector('button[data-act="edit"][data-g="3"]'), 'click');
    const none = mbox().querySelector('[data-bulk]') === null;
    d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    return none;
  })());
}

// ── template editor from the toolbar ──
{
  reset();
  fire(d.querySelector('#btnTpl'), 'click');
  ok('templates pop-up opens on 5★', mbox().textContent.includes('5★ default goal'));
  fire(mbox().querySelector('[data-tplswitch]'), 'click');
  ok('switch to the 4★ template', mbox().textContent.includes('4★ default goal'));
  const d4 = () => JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).defaults['4'];
  // edit level, a skill, and toggle a node — all persist to the save
  const ordSel = mbox().querySelector('select[data-tf="ord"]');
  ordSel.value = '13'; fire(ordSel, 'change');
  const s2sel = mbox().querySelector('select[data-tf="s2"]');
  s2sel.value = '9'; fire(s2sel, 'change');
  fire(mbox().querySelector('.node[data-tr="1"][data-tc="2"]'), 'click');   // skip Inherent Ⅱ
  ok('template edits persist', d4().ord === 13 && d4().skills[2] === 9 && d4().inh2 === 0 && d4().inh1 === 1);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  // new 4★ goals pick the edited template up
  palAdd('taoqi');
  const tCard = [...d.querySelectorAll('#goals .goal')].find(g2 => g2.textContent.includes('Taoqi'));
  ok('new 4★ goal uses the edited template',
     tCard.textContent.includes('Lv 1 → Lv 90') && tCard.querySelectorAll('.mini .sk')[2].textContent === '1→9');
  fire(tCard.querySelector('button[data-act="del"]'), 'click');
  // reset restores the built-in
  fire(d.querySelector('#btnTpl'), 'click');
  fire(mbox().querySelector('[data-tplswitch]'), 'click');
  fire(mbox().querySelector('[data-tplreset]'), 'click');
  ok('reset restores the built-in 4★ template',
     d4().ord === 11 && d4().skills.every(v => v === 6) && d4().major === 4 && d4().inh2 === 1);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
}

// ── inventory deduction: cards allocate in priority order, Total nets ──
{
  reset();                                   // queue Jinhsi (P1) / Phoebe (P2) / Suisui (P3)
  // Sentinel's Dagger (weekly) is shared by Jinhsi + Phoebe, 6 each. Give one
  // goal's share so the first card that needs it (P1 Jinhsi) eats the pool and
  // P2 Phoebe sees the leftover. Cleansing Conch fully stocked shows a covered ✓.
  w.eval(`state.inv["wk:Sentinel's Dagger"] = 6; state.inv["boss:Cleansing Conch"] = 46; save(); render();`);
  const tileIn = (sel, name) => [...d.querySelectorAll(sel + ' .tile')]
    .find(t => (t.getAttribute('title') || '').includes(name));
  const first = tileIn('.goal[data-g="0"]', "Sentinel's Dagger");   // Jinhsi
  const second = tileIn('.goal[data-g="1"]', "Sentinel's Dagger");  // Phoebe
  ok('P1 card: weekly covered — ✓, dimmed, tooltip says covered',
     first.textContent.includes('✓') && first.classList.contains('done') &&
     first.getAttribute('title').includes('covered'));
  ok('P2 card: pool already consumed by the first card that needed it',
     second.textContent.trim().endsWith('6') && !second.classList.contains('done'));
  // Total tab nets the aggregate: 12 needed − 6 held = 6
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Total'), 'click');
  const tot = tileIn('#summary', "Sentinel's Dagger");
  ok('Total tab deducts inventory with both numbers in the tooltip',
     tot.getAttribute('title').startsWith("Sentinel's Dagger — 6 needed of 12 total"));
  const conch = tileIn('#summary', 'Cleansing Conch');
  ok('fully covered material shows ✓ in Total', conch.textContent.includes('✓') && conch.classList.contains('done'));
}

// ── mark as completed: ✓ on finished cards, Completed summary tab ──
{
  reset();
  ok('unfinished cards have no ✓ button', d.querySelector('#goals [data-act="done"]') === null);
  // finish Phoebe: current = target, every planned node owned
  w.eval(`{ const g = state.goals.find(x => x.char === 'phoebe');
    g.cur = JSON.parse(JSON.stringify(g.tgt));
    g.nodes = g.nodes.map(r => r.map(v => v ? 2 : 0));
    syncNodeCounts(g); save(); render(); }`);
  const phCard = [...d.querySelectorAll('#goals .goal')].find(c => c.textContent.includes('Phoebe'));
  ok('finished card grows a ✓ button', phCard.querySelector('button[data-act="done"]') !== null);
  const before = d.querySelectorAll('#goals .goal').length;
  fire(phCard.querySelector('button[data-act="done"]'), 'click');
  ok('✓ moves the goal off the queue',
     d.querySelectorAll('#goals .goal').length === before - 1 && !texts('.gname').includes('Phoebe'));
  ok('Completed tab shows its count',
     [...d.querySelectorAll('#tabs button')].some(b => b.textContent === 'Completed (1)'));
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent.startsWith('Completed')), 'click');
  const dcard = () => d.querySelector('#summary .dgrid .dcard');
  ok('completed grid: a portrait tile — art, name under it, ↩ only',
     dcard() !== null && dcard().querySelector('.avatar') !== null &&
     dcard().querySelector('.dname').textContent === 'Phoebe' &&
     dcard().querySelector('[data-undone]') !== null &&
     // the name follows the portrait in the DOM (it sits below it in the column)
     dcard().querySelector('.avatar').compareDocumentPosition(dcard().querySelector('.dname')) ===
       w.Node.DOCUMENT_POSITION_FOLLOWING &&
     d.querySelector('#summary [data-rmdone]') === null &&      // no "forget" — ↩ then ✕ on the card
     d.querySelector('#summary .goalstat') === null && d.querySelector('#summary .mini') === null);
  ok('the detail a finished build no longer shows lives in the tooltip',
     /Phoebe — 5★ · Lv 90/.test(dcard().getAttribute('title')) &&
     /forte all 6/.test(dcard().getAttribute('title')) &&
     /nodes cover the 5★ template/.test(dcard().getAttribute('title')));
  // the tooltip still grades the build against the LIVE template
  w.eval('state.done[0].nodes[1][0] = 0; syncNodeCounts(state.done[0]); save(); render();');
  ok('a build below the template plan says so, naming the gap',
     /below the 5★ template: 1 major stat node/.test(dcard().getAttribute('title')));
  w.eval('state.done[0].nodes[1][0] = 2; syncNodeCounts(state.done[0]); save(); render();');
  ok('re-owning the node clears it', /nodes cover the 5★ template/.test(dcard().getAttribute('title')));
  // sections: characters and weapons, each rarity-then-alphabetical, collapsible
  w.eval(`{ const D = state.defaults;
            state.done.push(maxGoal(newGoal('baizhi', false, D)),      // 4★ char
                            maxGoal(newGoal('carlotta', false, D)),    // 5★ char
                            maxGoal(newWpnGoal('stringmaster', false)),
                            maxGoal(newWpnGoal('agesOfHarvest', false)));
            save(); render(); }`);
  const secs = () => [...d.querySelectorAll('#summary .dsec')].map(s2 => s2.textContent);
  const grid = k => [...d.querySelectorAll('#summary .dsec')]
    .find(s2 => s2.dataset.fold === k).nextElementSibling;
  const namesIn = k => [...grid(k).querySelectorAll('.dname')].map(n => n.textContent);
  ok('completed splits into Characters and Weapons, each counted',
     secs().length === 2 && /CHARACTERS/i.test(secs()[0]) && /3/.test(secs()[0]) &&
     /WEAPONS/i.test(secs()[1]) && /2/.test(secs()[1]));
  ok('each section sorts by rarity (5★ first) then alphabetically',
     namesIn('char').join() === 'Carlotta,Phoebe,Baizhi' &&      // 5★ C, 5★ P, then 4★
     namesIn('wpn').join() === 'Ages of Harvest,Stringmaster');
  ok('↩ still targets the right goal after the re-sort (index ≠ display order)',
     grid('char').querySelector('.dcard [data-undone]').dataset.undone ===
       String(w.eval(`state.done.findIndex(g => g.char === 'carlotta')`)));
  fire([...d.querySelectorAll('#summary .dsec')].find(s2 => s2.dataset.fold === 'wpn'), 'click');
  ok('a section header collapses its grid',
     d.querySelectorAll('#summary .dgrid').length === 1 &&
     [...d.querySelectorAll('#summary .dsec')].find(s2 => s2.dataset.fold === 'wpn')
       .classList.contains('shut'));
  fire([...d.querySelectorAll('#summary .dsec')].find(s2 => s2.dataset.fold === 'wpn'), 'click');
  ok('and expands it again', d.querySelectorAll('#summary .dgrid').length === 2);
  w.eval(`state.done = state.done.filter(g => g.char === 'phoebe'); save(); render();`);

  ok('completed list persisted',
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).done.some(g => g.char === 'phoebe'));
  // completed characters are hidden from the add palette
  fire(d.querySelector('#btnAdd'), 'click');
  const pIn = d.querySelector('#palIn');
  pIn.value = 'phoebe'; fire(pIn, 'input');
  ok('completed char hidden from the palette', d.querySelector('#palList').textContent.includes('No matches'));
  fire(d.querySelector('#palWrap'), 'click');                        // backdrop click closes
  // ↩ restores to the end of the queue with its state intact
  fire(d.querySelector('#summary [data-undone]'), 'click');
  ok('↩ restores to the end of the queue',
     texts('.gname').pop() === 'Phoebe' && d.querySelectorAll('#goals .goal').length === before);
  ok('restored goal keeps its finished state (✓ offered again)',
     [...d.querySelectorAll('#goals .goal')].find(c => c.textContent.includes('Phoebe'))
       .querySelector('button[data-act="done"]') !== null);
  // getting rid of a completion is ↩ (back to the queue) then ✕ on the card —
  // there is no "forget" button on the Completed tab any more
  const phCard2 = [...d.querySelectorAll('#goals .goal')].find(c => c.textContent.includes('Phoebe'));
  fire(phCard2.querySelector('button[data-act="del"]'), 'click');
  ok('↩ then ✕ removes the record entirely',
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).done.length === 0 &&
     !texts('.gname').includes('Phoebe'));
  fire(d.querySelector('#btnAdd'), 'click');
  const pIn2 = d.querySelector('#palIn');
  pIn2.value = 'phoebe'; fire(pIn2, 'input');
  ok('the deleted char is addable again', d.querySelector('#palList').textContent.includes('Phoebe'));
  fire(d.querySelector('#palWrap'), 'click');
}

// ── reorder pop-up (Ctrl+P): compact drag list, live apply ──
{
  reset();
  const wrapO = () => d.querySelector('#ordWrap');
  const rows = () => [...d.querySelectorAll('#ordList .ord-item')];
  const onames = () => [...d.querySelectorAll('#ordList .oname')].map(e2 => e2.textContent);
  ok('reorder pop-up hidden until opened', wrapO().hidden === true);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'p', ctrlKey:true, bubbles:true}));
  ok('Ctrl+P opens the reorder pop-up', wrapO().hidden === false);
  ok('one draggable row per goal, in queue order, with prio + rarity tag',
     rows().length === d.querySelectorAll('#goals .goal').length && rows().length >= 2 &&
     rows().every(r => r.getAttribute('draggable') === 'true') &&
     onames().every((n, i) => texts('.gname')[i].startsWith(n)) &&
     rows()[0].querySelector('.prio').textContent === 'P1' &&
     rows()[0].querySelector('.tag') !== null);
  ok('edge buttons disabled (first ▲, last ▼)',
     rows()[0].querySelector('[title="Move up"]').disabled === true &&
     rows()[rows().length - 1].querySelector('[title="Move down"]').disabled === true &&
     rows()[0].querySelector('[title="Move down"]').disabled === false);

  // ▼ on the first row swaps 0↔1 in the panel AND the card grid behind it
  const o0 = onames();
  fire(rows()[0].querySelector('[title="Move down"]'), 'click');
  ok('▼ moves the row down; panel stays open; main grid follows',
     wrapO().hidden === false && onames()[0] === o0[1] && onames()[1] === o0[0] &&
     texts('.gname')[0].startsWith(o0[1]) && texts('.gname')[1].startsWith(o0[0]));

  // drag the last row and drop on the first → moves to top (jsdom rects are 0 ⇒ "before")
  const oA = onames(), last = rows().length - 1;
  fire(rows()[last], 'dragstart');
  ok('dragging class applied to the row', rows()[last].classList.contains('dragging'));
  fire(rows()[0], 'drop');
  ok('drop moves the goal to the top of panel, grid, and save',
     onames()[0] === oA[last] && texts('.gname')[0].startsWith(oA[last]) &&
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).goals.length === oA.length);
  // self-drop is a no-op
  const oB = onames();
  fire(rows()[1], 'dragstart');
  fire(rows()[1], 'drop');
  ok('self-drop is a no-op', onames().join(',') === oB.join(','));

  // Ctrl+K hands over to the palette
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'k', ctrlKey:true, bubbles:true}));
  ok('Ctrl+K closes reorder and opens the palette',
     wrapO().hidden === true && d.querySelector('#palWrap').hidden === false);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

  // toolbar button opens; Esc, ✕, and backdrop all close
  fire(d.querySelector('#btnOrder'), 'click');
  ok('toolbar ⇅ opens it', wrapO().hidden === false);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  ok('Esc closes it', wrapO().hidden === true);
  fire(d.querySelector('#btnOrder'), 'click');
  fire(d.querySelector('#ordClose'), 'click');
  ok('✕ closes it', wrapO().hidden === true);
  fire(d.querySelector('#btnOrder'), 'click');
  fire(wrapO(), 'click');
  ok('backdrop click closes it', wrapO().hidden === true);

  // opening it from the goal editor closes the editor first
  fire(d.querySelector('button[data-act="edit"][data-g="0"]'), 'click');
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'p', ctrlKey:true, bubbles:true}));
  ok('Ctrl+P closes an open goal editor',
     d.querySelector('#modalWrap').hidden === true && wrapO().hidden === false);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
}

// ── sanitize: done list round-trips; a char can't be both queued and completed ──
{
  const domD = new JSDOM(html, {runScripts:'outside-only', url:'https://localhost/'});
  domD.window.localStorage.setItem('wuwa-planner-v1', JSON.stringify({
    goals:[{char:'jinhsi'}],
    done:[{char:'jinhsi'}, {char:'camellya', cur:{ord:13}, tgt:{ord:13}},
          {weapon:'stonard', cur:{ord:13}, tgt:{ord:13}}],
    tab:'done'}));
  domD.window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n'));
  const dD = domD.window.document;
  const savedD = JSON.parse(domD.window.localStorage.getItem('wuwa-planner-v1'));
  ok('sanitize: queued char wins over its done copy',
     savedD.done.length === 2 && !savedD.done.some(g => g.char === 'jinhsi'));
  ok('done tab persists and renders its grid', dD.querySelectorAll('#summary .dgrid .dcard').length === 2);
  ok('a character card grades its nodes in the tooltip; a weapon card has none to grade',
     /below the 5★ template/.test([...dD.querySelectorAll('.dcard')]
       .find(c => /Camellya/.test(c.textContent)).getAttribute('title')) &&
     !/template/.test([...dD.querySelectorAll('.dcard')]
       .find(c => /Stonard/i.test(c.textContent)).getAttribute('title')));
  ok('completed count shows on the tab',
     [...dD.querySelectorAll('#tabs button')].some(b => b.textContent === 'Completed (2)'));
}

// ── Teams page: matrix team builder behind the header nav ──
{
  reset();                                   // roster = Jinhsi/Phoebe/Suisui, no teams
  const nav = p => [...d.querySelectorAll('.pagenav button')].find(b => b.dataset.page === p);
  ok('pagenav present, Ledger page on by default',
     nav('ledger') !== null && nav('ledger').classList.contains('on') &&
     d.querySelector('#pageLedger').hidden === false && d.querySelector('#pageTeams').hidden === true);
  fire(nav('teams'), 'click');
  ok('Teams nav switches pages and sets the hash',
     d.querySelector('#pageTeams').hidden === false && d.querySelector('#pageLedger').hidden === true &&
     nav('teams').classList.contains('on') && w.location.hash === '#teams');

  const nChars = w.eval('state.goals.concat(state.done).filter(g => g.char !== undefined).length');
  ok('roster cards: one per character (weapons excluded), none spent',
     nChars >= 2 && d.querySelectorAll('#teams .rcard').length === nChars &&
     d.querySelectorAll('#teams .rcard.spent').length === 0);

  fire(d.querySelector('#btnTeam'), 'click');
  ok('add team: one team card in the grid, auto-named, 3 vertically stacked slots',
     d.querySelectorAll('#teams .tgrid .team').length === 1 &&
     d.querySelectorAll('#teams .slot.empty').length === 3 &&
     d.querySelector('#teams .team-h').textContent.includes('Team 1'));

  // empty slot → palette in pick mode: roster characters only, no weapons
  fire(d.querySelector('#teams .slot.empty'), 'click');
  ok('slot click opens the palette in pick mode (roster only, no weapons)',
     d.querySelector('#palWrap').hidden === false &&
     d.querySelectorAll('#palList .pal-item').length === nChars &&
     ![...d.querySelectorAll('#palList .tag')].some(t2 => t2.textContent.includes('weapon')) &&
     d.querySelector('#palIn').placeholder.includes('member'));
  fire(d.querySelector('#palList .pal-item'), 'click');
  const teamSave = () => JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).teams;
  ok('picking fills the slot and persists',
     d.querySelectorAll('#teams .slot.empty').length === 2 &&
     teamSave()[0].chars.filter(Boolean).length === 1);
  ok('used roster card dims (energy 1 spent)', d.querySelectorAll('#teams .rcard.spent').length === 1);

  // the next slot's picker no longer offers the spent character
  fire(d.querySelector('#teams .slot.empty'), 'click');
  ok('spent character hidden from the picker',
     d.querySelectorAll('#palList .pal-item').length === nChars - 1);
  fire(d.querySelector('#palWrap'), 'click');               // backdrop closes, pick cancelled
  ok('cancelled pick leaves the slot empty', d.querySelectorAll('#teams .slot.empty').length === 2);
  // Ctrl+K after a cancelled pick is a plain add-goal palette again (weapons back)
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'k', ctrlKey:true, bubbles:true}));
  ok('Ctrl+K reopens the palette in add mode',
     [...d.querySelectorAll('#palList .tag')].some(t2 => t2.textContent.includes('weapon')));
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

  // clicking the MEMBER area of a filled slot clears it and refunds the energy
  // (the weapon area beside it is its own button — see the link tests)
  fire(d.querySelector('#teams .slot .smem'), 'click');
  ok('clicking a filled slot clears it',
     d.querySelectorAll('#teams .slot.empty').length === 3 &&
     d.querySelectorAll('#teams .rcard.spent').length === 0);

  // deleting the goal strips the character from any team
  fire(d.querySelector('#teams .slot.empty'), 'click');
  fire(d.querySelector('#palList .pal-item'), 'click');
  const memberId = teamSave()[0].chars.find(Boolean);
  const gi = w.eval(`state.goals.findIndex(g => g.char === '${memberId}')`);
  fire(d.querySelector(`button[data-act="del"][data-g="${gi}"]`), 'click');
  ok('deleting the goal strips the character from teams',
     teamSave()[0].chars.every(c => c === null) &&
     d.querySelectorAll('#teams .slot.empty').length === 3);

  fire(d.querySelector('[data-rmteam="0"]'), 'click');
  ok('✕ deletes the team', d.querySelectorAll('#teams .team').length === 0 && teamSave().length === 0);

  fire(nav('ledger'), 'click');
  ok('Ledger nav returns and clears the hash',
     d.querySelector('#pageLedger').hidden === false && d.querySelector('#pageTeams').hidden === true &&
     w.location.hash !== '#teams');
}

// ── inventory pop-up (Ctrl+I): stock grid of icon + quantity tiles ──
{
  reset();
  const wrapI = () => d.querySelector('#invWrap');
  ok('stock pop-up hidden until opened', wrapI().hidden === true);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'i', ctrlKey:true, bubbles:true}));
  ok('Ctrl+I opens the stock grid', wrapI().hidden === false);
  ok('the wrapper is a real fixed overlay (CSS present, not just unhidden)',
     w.getComputedStyle(wrapI()).position === 'fixed');
  ok('every pop-up wrapper carries the fixed-overlay CSS',
     ['#modalWrap', '#palWrap', '#ordWrap', '#invWrap', '#farmWrap', '#undoBar'].every(s =>
       w.getComputedStyle(d.querySelector(s)).position === 'fixed'));
  // layout: the summary panel is bounded so the goals grid can auto-fill 3–4 cards.
  // A proportional (Nfr) summary column would pin the grid at two, whatever the width.
  {
    const cols = w.getComputedStyle(d.querySelector('.cols')).gridTemplateColumns;
    ok('the summary column is bounded, not proportional',
       /minmax\(\s*320px\s*,\s*400px\s*\)/.test(cols) && !/\dfr\s+minmax/.test(cols));
    ok('the goals column takes every remaining pixel', /minmax\(0,\s*1fr\)/.test(cols));
    ok('goal cards auto-fill at a 320px track',
       /auto-fill,\s*minmax\(min\(320px/.test(w.getComputedStyle(d.querySelector('#goals')).gridTemplateColumns));
  }
  ok('full catalog as tiles, one input each',
     d.querySelectorAll('#invGrid .itile').length > 100 &&
     d.querySelectorAll('#invGrid .iqty').length === d.querySelectorAll('#invGrid .itile').length);
  const tileOf = name => [...d.querySelectorAll('#invGrid .itile')]
    .find(t => (t.getAttribute('title') || '').startsWith(name));
  ok('tiles carry the plain material name as their title (no need info)',
     tileOf('Elegy Tacet Core').getAttribute('title') === 'Elegy Tacet Core' &&
     tileOf('Premium Resonance Potion').getAttribute('title') === 'Premium Resonance Potion');
  // game order inside a category: rarity bands DESCENDING, and within a band
  // the definition order (oldest → newest) — never an alphabetical re-sort
  {
    const section = label => [...d.querySelectorAll('#invGrid .cat')]
      .find(c => c.textContent === label).nextElementSibling;
    const tiles = label => [...section(label).querySelectorAll('.itile')];
    const secNames = label => tiles(label).map(t => t.getAttribute('title'));
    const rarities = label => tiles(label).map(t => +t.className.match(/r(\d)/)[1]);
    // definition order, stable-sorted by rarity descending — what the UI should render
    const wantNames = cat => w.eval(`Object.keys(MATS)
      .filter(id => id !== 'exp' && id !== 'wexp' && MATS[id].cat === ${JSON.stringify(cat)})
      .sort((a, b) => MATS[b].r - MATS[a].r)
      .map(id => MATS[id].name)`);
    for(const cat of ['EXP', 'Forgery', 'Enemy Drops']){
      ok(`${cat}: rarity never increases down the section (top tier first)`,
         rarities(cat).every((r, i, a) => i === 0 || a[i - 1] >= r) &&
         rarities(cat)[0] === 5);
      ok(`${cat}: definition order (oldest → newest) preserved inside each rarity band`,
         JSON.stringify(secNames(cat)) === JSON.stringify(wantNames(cat)));
    }
  }
  const q = tileOf('Elegy Tacet Core').querySelector('.iqty');
  q.value = '7'; fire(q, 'change');
  ok('typing a quantity saves it immediately',
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).inv['boss:Elegy Tacet Core'] === 7);
  ok('editing does not rebuild the grid (focus safety)', q.isConnected);
  // fuzzy filter box: subsequence match on the material name, live per keystroke
  {
    const find = d.querySelector('#invFind');
    const tiles = () => d.querySelectorAll('#invGrid .itile').length;
    find.value = 'lfhow'; fire(find, 'input');
    ok('the filter narrows the grid to a subsequence match',
       tiles() === 1 && tileOf('LF Howler Core') !== undefined);
    ok('the filter box keeps focus (it lives outside the rebuilt grid)', find.isConnected);
    // subsequence, not substring: every shown tile must score, none may be missing
    find.value = 'core'; fire(find, 'input');
    ok('a broader query keeps exactly the subsequence matches', tiles() > 1 && w.eval(`
      const shown = IGRID.map(id => MATS[id].name);
      const want = Object.keys(MATS).filter(id => id !== 'exp' && id !== 'wexp')
        .map(id => MATS[id].name).filter(n => fuzzyScore('core', n) >= 0);
      shown.length === want.length && want.every(n => shown.includes(n));`));
    find.value = 'zzzznope'; fire(find, 'input');
    ok('no match shows an empty note naming the query',
       tiles() === 0 && d.querySelector('#invGrid .empty').textContent.includes('zzzznope'));
    // Enter on a single match jumps into its input
    find.value = 'lfhow'; fire(find, 'input');
    find.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    ok('Enter on the last match focuses its quantity input',
       d.activeElement === d.querySelector('#invGrid .iqty[data-i="0"]'));
    find.value = ''; fire(find, 'input');
    ok('clearing the filter restores the catalog', tiles() > 100);
    // a stale filter must never survive a reopen
    find.value = 'lfhow'; fire(find, 'input');
    w.eval('openInv()');
    ok('reopening clears a stale filter and focuses it',
       find.value === '' && w.eval('invFilter') === '' && tiles() > 100 &&
       d.activeElement === find);
  }
  ok('the pop-up has no Craft 3→1 / Hide un-needed toggles (pure quantities)',
     d.querySelector('#invWrap #isynthChk') === null && d.querySelector('#invWrap #ihideChk') === null);
  // closing applies everywhere: give credits (every unfinished goal wants them)
  const cq = tileOf('Shell Credit').querySelector('.iqty');
  cq.value = '999999'; fire(cq, 'change');
  const goalsBefore = d.querySelector('#goals').innerHTML;
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  ok('Esc closes the grid', wrapI().hidden === true);
  ok('closing re-renders the goal cards with the new stock',
     d.querySelector('#goals').innerHTML !== goalsBefore);
  // Ctrl+K hands over to the palette
  fire(d.querySelector('#btnInv'), 'click');
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'k', ctrlKey:true, bubbles:true}));
  ok('Ctrl+K closes the stock grid and opens the palette',
     wrapI().hidden === true && d.querySelector('#palWrap').hidden === false);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  // backdrop closes too
  fire(d.querySelector('#btnInv'), 'click');
  fire(wrapI(), 'click');
  ok('backdrop click closes it', wrapI().hidden === true);
}

// ── upgrade tracks: horizontal Level/Nodes/Skill rows with +1 / Max ──
{
  reset();
  // Phoebe (index 1, not the top of the queue) at Lv20, empty stock
  w.eval(`Object.keys(state.inv).forEach(k => delete state.inv[k]);
    state.goals.find(x => x.char === 'phoebe').cur.ord = 1;
    save(); render();`);
  const gi = w.eval(`state.goals.findIndex(x => x.char === 'phoebe')`);
  fire(d.querySelector(`button[data-act="edit"][data-g="${gi}"]`), 'click');
  const trks = () => [...mbox().querySelectorAll('.trk')];
  const trk = lbl => trks().find(r => r.querySelector('.trk-lbl').textContent === lbl);
  const btn = (lbl, op) => trk(lbl).querySelector(`[data-op="${op}"]`);

  ok('upgrade section is grouped into tracks; Level leads with the current level',
     mbox().querySelector('.upg') !== null &&
     trks()[0].querySelector('.trk-lbl').textContent === 'Level' &&
     trks()[0].querySelector('.trk-cur').textContent === 'Lv 20');
  // preview order: Level (0), then Forte nodes (1), then the five skill tracks
  const trkLabels = () => trks().map(r => r.querySelector('.trk-lbl').textContent);
  ok('tracks appear in preview order: Level, Forte nodes, then skills',
     trkLabels()[0] === 'Level' && trkLabels()[1] === 'Forte nodes' &&
     trkLabels().length >= 3);
  ok('a weapon-less character exposes a Forte nodes track with a remaining count',
     /\d+ to buy/.test(trk('Forte nodes').querySelector('.trk-cur').textContent));

  ok('unaffordable +1: disabled, shortfall named in the tooltip',
     btn('Level', '1').disabled === true &&
     btn('Level', '1').getAttribute('title').includes('Missing:') &&
     btn('Level', '1').getAttribute('title').includes('LF Whisperin Core'));

  // fund the first ascension exactly (anchor: 4× LF Whisperin Core + 5,000 credits)
  w.eval(`state.inv.whisperin0 = 4; state.inv.credits = 5000; save(); render();`);
  ok('funded +1 enables and previews the level it reaches',
     btn('Level', '1').disabled === false &&
     btn('Level', '1').getAttribute('title').includes('Lv 20 ✦'));
  ok('queue priority never gates spending — this goal is not at the top', gi > 0);
  fire(btn('Level', '1'), 'click');
  ok('+1 advances one ordinal and drains the exact cost',
     w.eval(`state.goals[${gi}].cur.ord`) === 2 &&
     w.eval('state.inv.whisperin0 === undefined && state.inv.credits === undefined') === true);
  ok('the purchase arms the undo toast with the goal name',
     d.querySelector('#undoBar').hidden === false &&
     d.querySelector('#undoMsg').textContent.includes('Phoebe'));
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true}));
  ok('Ctrl+Z refunds both the level and the materials',
     w.eval(`state.goals[${gi}].cur.ord`) === 1 && w.eval('state.inv.whisperin0') === 4);

  // Max on the Level track with abundant stock jumps straight to the target
  w.eval(`{ Object.keys(state.inv).forEach(k => delete state.inv[k]);
    for(const id of Object.keys(MATS)) state.inv[id] = 9999;
    state.inv.exp4 = 9999; state.inv.credits = 9e8; save(); render(); }`);
  ok('Max previews the level it can reach (the target here)',
     btn('Level', 'max').getAttribute('title').includes('Lv 90') &&
     btn('Level', 'max').textContent.includes('Lv 90'));
  fire(btn('Level', 'max'), 'click');
  ok('Max advances all the way to target in one click',
     w.eval(`state.goals[${gi}].cur.ord`) === w.eval(`state.goals[${gi}].tgt.ord`));
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true}));
  ok('one Ctrl+Z reverts the whole Max jump', w.eval(`state.goals[${gi}].cur.ord`) === 1);

  // Max on the Forte nodes track buys every planned node (lowers before uppers,
  // so Inherent Ⅱ lands owned only because Ⅰ was bought first in the run)
  fire(btn('Forte nodes', 'max'), 'click');
  ok('Max buys every planned node, respecting the lower→upper gate',
     w.eval(`state.goals[${gi}].nodes.every(row => row.every(v => v === 0 || v === 2))`) === true &&
     w.eval(`state.goals[${gi}].nodes[1][2]`) === 2 &&      // Inherent Ⅱ owned
     mbox().querySelector('.trk-lbl') !== null &&
     [...mbox().querySelectorAll('.trk-lbl')].every(l => l.textContent !== 'Forte nodes'));  // track gone
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true}));

  // crafting-aware: a step affordable only by crafting 3→1 still buys
  w.eval(`{ Object.keys(state.inv).forEach(k => delete state.inv[k]);
    state.synth = true;
    const g = state.goals[${gi}];
    g.cur.ord = 3;                                          // next: a rank-2 ascension
    const cost = costForGoal({char:'phoebe', cur:g.cur, tgt:{...g.cur, ord:4, skills:[...g.cur.skills]}});
    window.__t1 = null;
    for(const [id, q] of Object.entries(cost)){
      if(id === 'exp') state.inv.exp4 = Math.ceil(q / 20000);
      else if(MATS[id] && MATS[id].family && MATS[id].tier === 1){
        state.inv[MATS[id].family + '0'] = q * 3; window.__t1 = id;   // held only as tier-0 ×3
      } else state.inv[id] = q;
    }
    save(); render(); }`);
  ok('craft scenario prepared (a tier-1 line held only as tier-0 ×3)', w.eval('window.__t1') !== null);
  ok('synth on: the step is affordable through crafting', btn('Level', '1').disabled === false);
  fire(btn('Level', '1'), 'click');
  ok('the purchase crafts the tier-0 stock away and advances',
     w.eval(`state.goals[${gi}].cur.ord`) === 4 &&
     w.eval('Object.keys(state.inv).every(k => !k.endsWith("0"))') === true);

  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  w.eval(`state.goals.splice(${gi}, 1);
    Object.keys(state.inv).forEach(k => delete state.inv[k]); save(); render();`);
}

// ── clicking a material icon opens the farm pop-up on its family ──
{
  reset();
  const farm = () => d.querySelector('#farmWrap');
  // inventory-style tiles: name lives in the title, not a text label
  const rows = () => [...d.querySelectorAll('#farmList .ftile')];
  const names = () => rows().map(r => r.getAttribute('title'));
  const nameOf = el => (el.getAttribute('title') || '').split(' — ')[0];
  const stockOf = n => w.eval(`state.inv[MAT_ID_BY_NAME[${JSON.stringify(n)}]] || 0`);
  ok('the farm pop-up is hidden until a material is clicked', farm().hidden === true);
  ok('it is a real fixed overlay', w.getComputedStyle(farm()).position === 'fixed');

  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Total'), 'click');
  const tileBy = pre => [...d.querySelectorAll('#summary .tile')]
    .find(t => (t.getAttribute('title') || '').startsWith(pre));

  // a family material: four tiers, low → high, under their shared name
  const fam = [...d.querySelectorAll('#summary .tile')]
    .find(t => w.eval(`(MATS[MAT_ID_BY_NAME[${JSON.stringify(nameOf(t))}]] || {}).family || ''`) !== '');
  const famName = nameOf(fam);
  fire(fam, 'click');
  ok('a tile click opens the farm pop-up, not the stock grid',
     farm().hidden === false && d.querySelector('#invWrap').hidden === true);
  ok('it lists exactly that material’s four tiers', rows().length === 4 &&
     names().join() === w.eval(
       `familyIds(MAT_ID_BY_NAME[${JSON.stringify(famName)}]).map(i => MATS[i].name).join()`));
  ok('the header names the family, not one tier',
     d.querySelector('#farmTitle').textContent === w.eval('famLabel(FARM)') &&
     !names().includes(d.querySelector('#farmTitle').textContent));

  // +1 / +5, Shift subtracts, clamped at zero — the tile steppers, relocated
  {
    const n0 = names()[0], base = stockOf(n0);
    const step = (k, shift) => rows()[0].querySelectorAll('.fstep')[k]
      .dispatchEvent(new w.MouseEvent('click', {bubbles:true, shiftKey:!!shift}));
    step(0);
    ok('+1 logs one drop and saves', stockOf(n0) === base + 1 &&
       JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).inv[w.eval('FARM[0]')] === base + 1);
    step(1);
    ok('+5 logs a farm session', stockOf(n0) === base + 6);
    ok('the input mirrors the new stock', +rows()[0].querySelector('.fqty').value === base + 6);
    ok('stepping never rebuilds the rows', rows()[0].querySelector('.fqty').isConnected);
    for(let k = 0; k < 4; k++) step(1, true);            // −20, well past zero
    ok('a stepper never drives stock below zero', stockOf(n0) === 0 &&
       w.eval('state.inv[FARM[0]] === undefined') === true);
    ok('a zeroed row shows an empty input, not a 0', rows()[0].querySelector('.fqty').value === '');
  }

  // tiles are inventory-style now: icon + quantity, name on hover, no need/left
  {
    ok('a farm tile carries only the plain material name (no need/left)',
       rows()[1].getAttribute('title') === names()[1] &&
       rows()[1].querySelector('.fneed') === null &&
       !/left|covered|needed/.test(rows()[1].getAttribute('title')));
    const inp = rows()[1].querySelector('.fqty');
    inp.value = '12'; fire(inp, 'change');
    ok('typing an exact number saves it', stockOf(names()[1]) === 12);
  }

  // closing applies everywhere, exactly like the inventory pop-up
  {
    const inp = rows()[1].querySelector('.fqty');
    inp.value = '12'; fire(inp, 'change');
    const before = d.querySelector('#goals').innerHTML;
    d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    ok('Esc closes the farm pop-up', farm().hidden === true);
    ok('closing re-renders the goal cards with the new stock',
       d.querySelector('#goals').innerHTML !== before);
    w.eval('FARM.forEach(i => delete state.inv[i]); save(); render();');
  }

  // a singleton (weekly / boss / credits) opens on itself alone
  {
    const one = tileBy("Sentinel's Dagger") || tileBy('Shell Credit');
    const nm = nameOf(one);
    fire(one, 'click');
    ok('a material with no family shows only itself',
       rows().length === 1 && names()[0] === nm &&
       d.querySelector('#farmTitle').textContent === nm);
    d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  }

  // Ctrl+I still reaches the stock grid, and it now lands on the filter
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'i', ctrlKey:true, bubbles:true}));
  ok('opening the stock grid focuses the filter box',
     d.activeElement === d.querySelector('#invFind'));
  ok('stock tiles carry no steppers any more', d.querySelectorAll('#invGrid .istep').length === 0);
  ok('stock tiles are inert — clicking one opens nothing', (() => {
    fire(d.querySelector('#invGrid .itile'), 'click');
    return farm().hidden === true;
  })());
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
}

// ── multi-level undo: toast + Ctrl+Z walk back through the snapshot stack ──
{
  reset();                                   // clean queue + empty undo stack
  const bar = () => d.querySelector('#undoBar');
  const before = texts('.gname');
  fire(d.querySelector('button[data-act="del"][data-g="0"]'), 'click');
  ok('deleting a goal shows the undo toast naming it',
     bar().hidden === false &&
     d.querySelector('#undoMsg').textContent.startsWith('Removed ') &&
     texts('.gname').length === before.length - 1);
  fire(d.querySelector('#btnUndo'), 'click');
  ok('Undo restores the queue in order',
     JSON.stringify(texts('.gname')) === JSON.stringify(before) && bar().hidden === true);

  // Ctrl+Z path, via a team deletion on the Teams page
  fire([...d.querySelectorAll('.pagenav button')].find(b => b.dataset.page === 'teams'), 'click');
  fire(d.querySelector('#btnTeam'), 'click');
  fire(d.querySelector('[data-rmteam="0"]'), 'click');
  ok('team deletion arms undo', d.querySelectorAll('#teams .team').length === 0 && bar().hidden === false);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true}));
  ok('Ctrl+Z restores the team', d.querySelectorAll('#teams .team').length === 1);
  // Ctrl+Z from inside an input is left to the browser's native undo
  fire(d.querySelector('[data-rmteam="0"]'), 'click');
  const inp = d.createElement('input'); d.body.appendChild(inp);
  inp.dispatchEvent(new w.KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true}));
  ok('Ctrl+Z inside an input does not undo', d.querySelectorAll('#teams .team').length === 0);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true}));
  ok('…and the snapshot stays armed for the real Ctrl+Z', d.querySelectorAll('#teams .team').length === 1);
  inp.remove();
  fire(d.querySelector('[data-rmteam="0"]'), 'click');        // leave no teams behind
  fire([...d.querySelectorAll('.pagenav button')].find(b => b.dataset.page === 'ledger'), 'click');

  // depth: three wrapped mutations, three undos, back to the starting value
  // (a stock number keeps the assertions independent of the queue length)
  const stock = () => w.eval('state.inv.howler0 || 0');
  w.eval(`undoStack.length = 0; delete state.inv.howler0; save();
          for(const k of [1, 2, 3]) withUndo('set ' + k, () => state.inv.howler0 = k);`);
  ok('three wrapped mutations stack three snapshots',
     w.eval('undoStack.length') === 3 && stock() === 3);
  ok('the toast names the newest step and counts the ones behind it',
     d.querySelector('#undoMsg').textContent === 'set 3 · 3 steps back');
  fire(d.querySelector('#btnUndo'), 'click');
  ok('one undo pops one snapshot and re-arms the next',
     w.eval('undoStack.length') === 2 && stock() === 2 && bar().hidden === false &&
     d.querySelector('#undoMsg').textContent === 'set 2 · 2 steps back');
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true}));
  ok('the last snapshot drops the step counter', d.querySelector('#undoMsg').textContent === 'set 1');
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true}));
  ok('undoing to the bottom restores the original value and hides the toast',
     stock() === 0 && w.eval('undoStack.length') === 0 && bar().hidden === true);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true}));
  ok('undoing an empty stack is a no-op', stock() === 0);
  ok('the ring buffer drops the oldest past UNDO_MAX', w.eval(`
    undoStack.length = 0;
    for(let k = 0; k < UNDO_MAX + 5; k++) withUndo('x' + k, () => {});
    [undoStack.length, undoStack[0].label].join(',')`) === `${w.eval('UNDO_MAX')},x5`);
  w.eval(`undoStack.length = 0; $('#undoBar').hidden = true;`);
}

// ── backup: button gated on File System Access; Export stamps the meta key ──
{
  ok('backup button hidden without the File System Access API (jsdom)',
     d.querySelector('#btnBackup').hidden === true);
  ok('no backup stamp before the first export',
     w.localStorage.getItem('wuwa-planner-meta') === null);
  fire(d.querySelector('#btnExport'), 'click');               // download part is try/caught in jsdom
  const meta = JSON.parse(w.localStorage.getItem('wuwa-planner-meta') || '{}');
  ok('Export stamps lastBackup', typeof meta.lastBackup === 'number' && meta.lastBackup > 0);
}

// ── backup staleness: boot nags when the last backup is over a week old ──
{
  const domB = new JSDOM(html, {runScripts:'outside-only', url:'https://localhost/'});
  domB.window.localStorage.setItem('wuwa-planner-meta',
    JSON.stringify({lastBackup: Date.now() - 12 * 86400000}));
  domB.window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n'));
  const noteB = domB.window.document.querySelector('#storageNote');
  ok('boot note warns about a 12-day-old backup',
     noteB.textContent.includes('12 days ago') && noteB.className.includes('warn'));
  ok('undo toast hidden at boot', domB.window.document.querySelector('#undoBar').hidden === true);
  domB.window.close();
}

// ── Teams: #teams hash boot + save repair (dupes, budget, unknown ids) ──
{
  const domT = new JSDOM(html, {runScripts:'outside-only', url:'https://localhost/#teams'});
  domT.window.localStorage.setItem('wuwa-planner-v1', JSON.stringify({
    goals:[{char:'jinhsi'}, {char:'phoebe'}],
    teams:[{chars:['jinhsi', 'jinhsi', 'phoebe']},           // dup within one team
           {chars:['phoebe', 'notachar', 'verina']},         // over budget + unknown + non-roster
           'garbage'],
  }));
  domT.window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n'));
  const dT = domT.window.document;
  ok('#teams hash boots straight to the Teams page',
     dT.querySelector('#pageTeams').hidden === false && dT.querySelector('#pageLedger').hidden === true);
  const savedT = JSON.parse(domT.window.localStorage.getItem('wuwa-planner-v1'));
  ok('sanitize repairs teams: within-team dupe, energy budget, unknown ids, garbage rows',
     JSON.stringify(savedT.teams.map(t => t.chars)) === '[["jinhsi",null,"phoebe"],[null,null,null]]');
  ok('repaired teams render (2 teams, 2 filled slots, both chips spent)',
     dT.querySelectorAll('#teams .team').length === 2 &&
     dT.querySelectorAll('#teams .slot:not(.empty)').length === 2 &&
     dT.querySelectorAll('#teams .rcard.spent').length === 2);
  ok('old saves without teams default to none (jsdom main dom booted clean)', Array.isArray(savedT.teams));
}

// ── pause a goal: ⏸ keeps it in the queue but out of every calculation ──
{
  reset();                                   // Jinhsi (P1) / Phoebe (P2) / Suisui (P3)
  const card = i => d.querySelector(`.goal[data-g="${i}"]`);
  const totalCredits = () => {               // exact figure lives in the tile's tooltip
    const t = [...d.querySelectorAll('#summary .tile')]
      .find(x => (x.getAttribute('title') || '').startsWith('Shell Credit'));
    return t ? +t.getAttribute('title').match(/([\d,]+) needed/)[1].replace(/,/g, '') : -1;
  };
  const before = totalCredits();
  ok('every card starts active — no dimming, ⏸ offered', d.querySelectorAll('.goal.off').length === 0 &&
     card(1).querySelector('[data-act="off"]').textContent === '⏸');

  fire(card(1).querySelector('[data-act="off"]'), 'click');       // pause Phoebe
  ok('the paused card stays in place, dimmed, and offers ▶',
     d.querySelectorAll('.goal').length === 3 && card(1).classList.contains('off') &&
     card(1).querySelector('[data-act="off"]').textContent === '▶');
  ok('no PAUSED tag — dimming is the whole signal', d.querySelectorAll('.goal .badge').length === 0);
  ok('a paused goal drops out of the Total aggregate', totalCredits() > 0 && totalCredits() < before);
  ok('Total says how many goals it left out',
     /for 2 goals/.test(d.querySelector('#summary').textContent) &&
     /1 paused goal is left out/.test(d.querySelector('#summary').textContent));
  ok('the paused card still shows its own full cost',
     card(1).querySelectorAll('.goal-mats .tile').length > 5);
  ok('paused survives a save/reload round-trip',
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).goals.map(g => !!g.off).join() === 'false,true,false');

  // the pool flows past it: stock the shared weekly and the paused P2 must not eat it
  w.eval(`state.inv["wk:Sentinel's Dagger"] = 6; save(); render();`);
  const wkTile = i => [...card(i).querySelectorAll('.tile')]
    .find(t => (t.getAttribute('title') || '').includes("Sentinel's Dagger"));
  ok('inventory is allocated past the paused goal — P1 still eats the stock',
     wkTile(0).classList.contains('done') && !wkTile(1).classList.contains('done'));
  ok('the paused goal claims none of it (shows all 6 of its own need)',
     wkTile(1).textContent.trim().endsWith('6'));

  // Farm next plans nothing for it: pause everything and the plan empties
  w.eval(`state.inv = {}; state.goals.forEach(g => g.off = true); save(); render();`);
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Total'), 'click');
  ok('all paused → Total says so instead of showing an empty deficit',
     /Every goal is paused/.test(d.querySelector('#summary').textContent));
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Farm next'), 'click');
  ok('all paused → Farm next proposes no runs', d.querySelectorAll('#summary .run').length === 0);
  w.eval(`state.goals.forEach(g => g.off = false); state.tab = 'total'; save(); render();`);
  ok('resuming brings the totals back', totalCredits() === before);

  // paused is a queue-only state: marking a goal done clears it
  w.eval(`{ const g = state.goals[0]; g.off = true; g.cur = JSON.parse(JSON.stringify(g.tgt));
            g.nodes = g.nodes.map(r => r.map(v => v ? 2 : 0)); syncNodeCounts(g); save(); render(); }`);
  ok('a paused-but-finished card offers no ✓ (resume it first)',
     card(0).querySelector('[data-act="done"]') === null);
  fire(card(0).querySelector('[data-act="off"]'), 'click');       // resume → ✓ appears
  fire(card(0).querySelector('[data-act="done"]'), 'click');
  ok('completing a goal drops the paused flag',
     w.eval('state.done.length') === 1 && w.eval('!!state.done[0].off') === false);
}

// ── craft mode: the 3→1 rule is pickable (reserve ⇄ priority) ──
{
  reset();
  const sel = () => d.querySelector('#craftMode');
  ok('the picker sits on the Total tab, defaulting to the cautious rule',
     sel() !== null && sel().value === 'reserve' &&
     [...sel().options].map(o => o.value).join() === 'reserve,priority');

  const synth = d.querySelector('#synthChk');
  synth.checked = false; fire(synth, 'change');                   // crafting off
  ok('with crafting off the picker is gone (the choice is meaningless)', sel() === null);
  const synth2 = d.querySelector('#synthChk');
  synth2.checked = true; fire(synth2, 'change');                  // back on
  ok('turning crafting back on restores the picker', sel() !== null);

  /* A real contention, both goals in the HOWLER family (Jinhsi and Jiyan share
     it): P1 wants 12× howler2, craftable from 36× howler1; P2 needs 3× howler1
     directly. Stock is 38 — one short of serving both, so the rules disagree. */
  w.eval(`{ const D = {4: defaultGoalTgt(4), 5: defaultGoalTgt(5)};
            const flat = g => { g.tgt.skills = [...g.cur.skills];
                                g.nodes = [[0,0,0,0,0],[0,0,0,0,0]]; syncNodeCounts(g); return g; };
            const j = flat(newGoal('jinhsi', false, D)); j.cur.ord = 6; j.tgt.ord = 11;  // 12× howler2
            const y = flat(newGoal('jiyan',  false, D));                                 // 3× howler1
            y.cur.ord = 0; y.tgt.ord = 0; y.tgt.inh1 = 1;   // Lv1, buying Inherent Ⅰ only
            state.goals = [j, y]; state.inv = {howler1: 38}; save(); render(); }`);
  const rem = (g, id) => +w.eval(`theWalk()[${g}].rem['${id}'] || 0`);
  ok('reserve: P2 keeps the tier-1 stock it needs directly, so P1 ends 1 short',
     rem(0, 'howler2') === 1 && rem(1, 'howler1') === 0);

  sel().value = 'priority'; fire(sel(), 'change');
  ok('priority: the top goal crafts all 36 and finishes; P2 is the one left short',
     rem(0, 'howler2') === 0 && rem(1, 'howler1') === 1 && w.eval('state.craftMode') === 'priority');
  ok('the choice persists in the save',
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).craftMode === 'priority');
  ok('the picker reflects the stored choice after a re-render',
     (w.eval('render()'), d.querySelector('#craftMode').value === 'priority'));
  ok('an unknown craftMode sanitizes back to reserve',
     w.eval(`sanitize({craftMode: 'nonsense'}).craftMode`) === 'reserve' &&
     w.eval(`sanitize({}).craftMode`) === 'reserve' &&
     w.eval(`sanitize({craftMode: 'priority'}).craftMode`) === 'priority');
  w.eval(`state.craftMode = 'reserve'; save();`);
}

// ── character⇄weapon link: owner row, weapon-type rule, one weapon per char ──
{
  reset();                                   // Jinhsi (Broadblade) / Phoebe, Suisui (Rectifier)
  // P4 Ages of Harvest + P5 Verdant Summit are Broadblades; P6 Stringmaster is a Rectifier
  w.eval(`state.goals.push(newWpnGoal('agesOfHarvest', false), newWpnGoal('verdantSummit', false),
                           newWpnGoal('stringmaster', false));
          save(); render();`);
  const wcard = i => d.querySelector(`.goal[data-g="${i}"]`);
  const ownerBtn = i => wcard(i).querySelector('[data-act="own"]');
  const palNames = () => [...d.querySelectorAll('#palList .pal-item')].map(e => e.textContent);
  ok('a weapon card starts unlinked and invites a link',
     ownerBtn(3).classList.contains('none') &&
     /Not linked/.test(ownerBtn(3).getAttribute('title')) &&
     wcard(0).querySelector('[data-act="own"]') === null);   // character cards carry no owner chip

  // a Broadblade offers only Broadblade characters (Jinhsi), never Phoebe/Suisui
  fire(ownerBtn(3), 'click');
  ok('the owner palette offers only characters of the weapon’s type',
     d.querySelector('#palWrap').hidden === false &&
     palNames().length === 1 && palNames()[0].includes('Jinhsi') &&
     /Broadblade character/.test(d.querySelector('#palIn').placeholder));
  fire(d.querySelector('#palList .pal-item'), 'click');
  ok('picking an owner links it and the chip becomes their avatar',
     w.eval(`state.goals[3].owner`) === 'jinhsi' &&
     !ownerBtn(3).classList.contains('none') &&
     ownerBtn(3).querySelector('.avatar img.__ico').getAttribute('src') === 'images/characters/jinhsi_icon.png' &&
     /Jinhsi carries this/.test(ownerBtn(3).getAttribute('title')));
  ok('the link persists in the save',
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).goals[3].owner === 'jinhsi');

  // the Rectifier has no eligible owner in this roster… wait, Phoebe/Suisui are Rectifier users
  fire(ownerBtn(5), 'click');
  ok('a Rectifier offers the Rectifier users, not the Broadblade one',
     palNames().length === 2 && !palNames().some(n => n.includes('Jinhsi')));
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

  // one character carries ONE weapon: linking a second Broadblade moves the link
  fire(ownerBtn(4), 'click');
  fire([...d.querySelectorAll('#palList .pal-item')].find(e => e.textContent.includes('Jinhsi')), 'click');
  ok('linking a second weapon to the same character unlinks the first',
     w.eval(`[state.goals[3].owner, state.goals[4].owner].join()`) === ',jinhsi');

  wcard(4).querySelector('[data-act="own"]')
    .dispatchEvent(new w.MouseEvent('contextmenu', {bubbles:true, cancelable:true}));
  ok('right-click on the chip unlinks', w.eval(`state.goals[4].owner`) === undefined &&
     wcard(4).querySelector('[data-act="own"]').classList.contains('none'));

  // sanitize enforces the type rule on load (a hand-edited/older save can't smuggle one in)
  ok('sanitize drops a link the character could never wield',
     w.eval(`sanitize({goals:[{char:'jinhsi'}, {weapon:'stringmaster', owner:'jinhsi'}]})
              .goals[1].owner`) === undefined &&
     w.eval(`sanitize({goals:[{char:'jinhsi'}, {weapon:'agesOfHarvest', owner:'jinhsi'}]})
              .goals[1].owner`) === 'jinhsi');

  // a character leaving the roster takes its links with it
  w.eval(`state.goals[3].owner = 'jinhsi'; save(); render();`);
  fire(wcard(0).querySelector('[data-act="del"]'), 'click');      // delete Jinhsi
  ok('deleting the character unlinks its weapon',
     w.eval(`state.goals.filter(isWpn).every(g => g.owner === undefined)`) === true);
  w.eval(`doUndo()`);                                            // put Jinhsi back
  ok('undo restores the character and its link',
     w.eval(`state.goals[0].char`) === 'jinhsi' && w.eval(`state.goals[3].owner`) === 'jinhsi');
}

// ── Teams page: roster panel, drag-to-slot, auto names, reorder, prioritize ──
{
  reset();
  w.eval(`state.goals.push(newWpnGoal('agesOfHarvest', false));
          state.goals[3].owner = 'jinhsi';
          state.teams = [{chars:['phoebe', null, null]}, {chars:['jinhsi', null, null]}];
          save(); showPage('teams'); render();`);
  const rcards = () => [...d.querySelectorAll('#teams .rcard')];
  const rcard = n => rcards().find(c => c.dataset.c === n);
  const teamNames = () => [...d.querySelectorAll('#teams .team .tname')].map(e => e.textContent);

  const bars = n => [...rcard(n).querySelectorAll('.energy i')];
  const lit  = n => bars(n).map(b => b.classList.contains('on') ? 1 : 0).join('');
  ok('one energy bar per point of budget, lit while that point is free',
     rcard('jinhsi').querySelector('.rlv').textContent.includes('Lv 1') &&
     bars('jinhsi').length === 1 && lit('jinhsi') === '0' &&      // energy 1, spent in a team
     bars('suisui').length === 2 && lit('suisui') === '11' &&     // energy 2, none used
     rcard('jinhsi').querySelector('.rwpn .wname').textContent.includes('Ages of Harvest'));
  // spending one of Suisui's two points drains the LEFT bar first
  w.eval(`state.teams.push({chars:['suisui', null, null]}); save(); render();`);
  ok('energy drains left to right', lit('suisui') === '01');
  w.eval(`state.teams.pop(); save(); render();`);
  ok('an unlinked character shows the empty weapon slot',
     rcard('phoebe').querySelector('.rwpn').classList.contains('none'));
  ok('a character already in a team has no energy left and cannot be dragged',
     rcard('jinhsi').classList.contains('spent') &&
     rcard('jinhsi').getAttribute('draggable') === 'false' &&
     rcard('suisui').getAttribute('draggable') === 'true');
  ok('teams are auto-named after their first member', teamNames().join() === 'Phoebe,Jinhsi');
  // Jinhsi and Phoebe each sit in a team (energy 1, spent); Suisui is free
  const spentSeq = () => rcards().map(c => c.classList.contains('spent') ? 1 : 0);
  ok('the roster floats characters with energy left to the top, spent ones sink',
     spentSeq().includes(0) && spentSeq().includes(1) &&
     spentSeq().every((v, i, a) => i === 0 || a[i-1] <= v));
  const slotOf = n => [...d.querySelectorAll('#teams .slot')].find(s => new RegExp(n).test(s.textContent));
  ok('a team slot shows the weapon its character carries',
     slotOf('Jinhsi').querySelector('.swpn img.__ico').getAttribute('src') ===
       'images/weapons/ages_of_harvest_icon.png' &&
     /Ages of Harvest/.test(slotOf('Jinhsi').querySelector('.smem').getAttribute('title')));
  // an unarmed member keeps the weapon area (a ＋) — you can link without
  // removing them from the team
  const pWpn = slotOf('Phoebe').querySelector('.swpn');
  ok('an unarmed member keeps a ＋ weapon button',
     pWpn !== null && pWpn.classList.contains('none') && pWpn.dataset.eq === 'phoebe');
  fire(pWpn, 'click');
  ok('clicking it opens the equip palette and leaves the member in the team',
     d.querySelector('#palWrap').hidden === false &&
     /weapon from your ledger/.test(d.querySelector('#palIn').placeholder) &&
     w.eval(`state.teams.some(t => t.chars.includes('phoebe'))`) === true);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

  // the roster card's weapon slot picks from the LEDGER's weapons only
  // the ledger's only weapon is Jinhsi's Broadblade — nothing Phoebe could hold
  fire(rcard('phoebe').querySelector('.rwpn'), 'click');
  ok('the equip palette offers no weapon of the wrong type, and says why',
     d.querySelectorAll('#palList .pal-item').length === 0 &&
     /No Rectifier weapon in your ledger/.test(d.querySelector('#palList').textContent));
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  w.eval(`state.goals.push(newWpnGoal('stringmaster', false)); save(); render();`);
  fire(rcard('phoebe').querySelector('.rwpn'), 'click');
  ok('a free LEDGER weapon of her type shows up (not the 89-weapon catalog)',
     d.querySelectorAll('#palList .pal-item').length === 1 &&
     d.querySelector('#palList .pal-item').textContent.includes('Stringmaster') &&
     /Rectifier weapon from your ledger/.test(d.querySelector('#palIn').placeholder));
  fire(d.querySelector('#palList .pal-item'), 'click');
  ok('the roster card now shows Phoebe’s weapon',
     w.eval(`equipOf(wpnGoals(), 'phoebe').weapon`) === 'stringmaster' &&
     rcard('phoebe').querySelector('.rwpn .wname').textContent.includes('Stringmaster'));

  // fuzzy filter over the roster panel (same fuzzyScore as the palette/inventory)
  const find = () => d.querySelector('#rosterFind');
  const rnames = () => rcards().map(c => c.dataset.c);
  const allNames = rnames();
  find().value = 'sui'; fire(find(), 'input');
  ok('the filter narrows the roster', rnames().join() === 'suisui' && allNames.length > 1);
  ok('the input keeps its value (it lives outside the rebuilt list, so focus survives)',
     d.querySelector('#rosterFind').value === 'sui' &&
     d.querySelector('#rosterFind') === find());          // the node itself was not replaced
  find().value = 'zzz'; fire(find(), 'input');
  ok('no match says so', /No character matches/.test(d.querySelector('#rlist').textContent) &&
     rcards().length === 0);
  find().value = ''; fire(find(), 'input');
  ok('clearing it brings the whole roster back', rnames().join() === allNames.join());

  // drag a roster card onto an empty slot
  const emptySlot = () => d.querySelector('#teams .team[data-t="0"] .slot.empty');
  fire(rcard('suisui'), 'dragstart');
  ok('dragging a roster card marks it', rcard('suisui').classList.contains('dragging'));
  fire(emptySlot(), 'drop');
  ok('dropping fills the slot and persists',
     w.eval(`state.teams[0].chars[1]`) === 'suisui' &&
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).teams[0].chars[1] === 'suisui');

  // reorder teams by dragging (jsdom rects are 0 ⇒ the drop resolves "before")
  fire(d.querySelector('#teams .team[data-t="1"]'), 'dragstart');
  fire(d.querySelector('#teams .team[data-t="0"]'), 'drop');
  ok('dragging a team card reorders the grid', teamNames().join() === 'Jinhsi,Phoebe');

  // ⚑ prioritize: members to the front (queue order kept), weapons in tow,
  // paused members resume, and we land back on the Ledger
  w.eval(`state.goals[1].off = true;                       // pause Phoebe
          state.teams = [{chars:['suisui', 'phoebe', null]}];
          save(); showPage('teams'); render();`);
  const queue = () => w.eval(`JSON.stringify(state.goals.map(g =>
    g.char !== undefined ? g.char : 'w:' + g.weapon))`);
  ok('queue before: jinhsi, phoebe, suisui, + two weapons',
     queue() === '["jinhsi","phoebe","suisui","w:agesOfHarvest","w:stringmaster"]');
  fire(d.querySelector('#teams [data-prio]'), 'click');
  ok('prioritize: members keep their queue order, each weapon behind its owner',
     queue() === '["phoebe","w:stringmaster","suisui","jinhsi","w:agesOfHarvest"]');
  ok('a paused member resumes when prioritized', w.eval(`!!state.goals[0].off`) === false);
  ok('prioritizing lands on the Ledger page',
     d.querySelector('#pageLedger').hidden === false && d.querySelector('#pageTeams').hidden === true);
  w.eval(`doUndo()`);
  ok('one Ctrl+Z puts the whole queue back (paused state included)',
     queue() === '["jinhsi","phoebe","suisui","w:agesOfHarvest","w:stringmaster"]' &&
     w.eval(`!!state.goals[1].off`) === true);
  w.eval(`location.hash = ''; showPage('ledger');`);
}

// ── add-palette filter chips: rarity · element · weapon type ──
{
  reset();
  fire(d.querySelector('#btnAdd'), 'click');
  const chips = f => [...d.querySelectorAll(`#palFilt [data-facet="${f}"]`)];
  const items = () => [...d.querySelectorAll('#palList .pal-item')];
  const tags  = () => items().map(e => e.querySelector('.tag').textContent);
  ok('the chip row offers rarity, every element and every weapon type',
     chips('r').length === 3 && chips('el').length === 6 && chips('wt').length === 5 &&
     d.querySelector('#palFilt .fchip .attr-img') !== null);
  const all = items().length;

  fire(chips('r').find(c => c.dataset.val === '4'), 'click');
  ok('a rarity chip narrows to that rarity (chars AND weapons)',
     items().length < all && tags().every(x => x.startsWith('4★')) &&
     chips('r').find(c => c.dataset.val === '4').classList.contains('on'));

  fire(chips('r').find(c => c.dataset.val === '4'), 'click');       // toggle off
  ok('clicking it again clears it', items().length === all);

  fire(chips('el').find(c => c.dataset.val === 'Spectro'), 'click');
  ok('an element chip implies characters (weapons have no element)',
     items().length > 0 && tags().every(x => x.endsWith('char')));
  const spectro = items().length;

  // facets AND: adding a weapon-type chip can only narrow the element result
  fire(chips('wt').find(c => c.dataset.val === 'Broadblade'), 'click');
  const both = items().length;
  ok('facets AND together: Spectro + Broadblade ⊆ Spectro', both <= spectro);
  fire(chips('wt').find(c => c.dataset.val === 'Broadblade'), 'click');   // back off
  ok('…and dropping the second facet restores the first', items().length === spectro);

  fire(d.querySelector('#palFilt [data-facet="clear"]'), 'click');
  ok('✕ clears every facet at once',
     items().length === all && d.querySelectorAll('#palFilt .fchip.on').length === 0);

  // a weapon-type chip alone matches BOTH the characters and the weapons of that type
  fire(chips('wt').find(c => c.dataset.val === 'Rectifier'), 'click');
  ok('a weapon-type chip matches characters and weapons alike',
     tags().some(x => x.endsWith('char')) && tags().some(x => x.endsWith('weapon')));

  // typing still narrows within the filters
  const pIn = d.querySelector('#palIn');
  pIn.value = 'zzzz'; fire(pIn, 'input');
  ok('a filtered dead end says the filters may be too narrow',
     /filters above may be too narrow/.test(d.querySelector('#palList').textContent));
  pIn.value = ''; fire(pIn, 'input');

  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  fire(d.querySelector('#btnAdd'), 'click');
  ok('reopening the palette starts unfiltered',
     d.querySelectorAll('#palFilt .fchip.on').length === 0 && items().length === all);
  // the filter row is hidden in a pick mode (nothing to filter there)
  w.eval(`closePal(); openPal({mode:'slot', t:0, s:0})`);
  ok('no filter row in a pick mode', d.querySelector('#palFilt').hidden === true);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
}

// ── shortcuts / power-features cheat sheet (Ctrl+/ or the toolbar button) ──
{
  reset();
  const wrap = () => d.querySelector('#keysWrap');
  ok('the cheat sheet starts hidden', wrap().hidden === true);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'/', ctrlKey:true, bubbles:true}));
  ok('Ctrl+/ opens it, anchored as a non-blocking panel (wrap passes clicks through)',
     wrap().hidden === false &&
     w.getComputedStyle(wrap()).pointerEvents === 'none' &&
     d.querySelector('.keys-pop') !== null);
  ok('it lists the grouped shortcuts with keycaps',
     d.querySelectorAll('#keysBody .keys-grp').length === 4 &&
     d.querySelectorAll('#keysBody .keys-row').length >= 12 &&
     d.querySelector('#keysBody kbd') !== null &&
     /Add a character/.test(d.querySelector('#keysBody').textContent) &&
     /ALREADY BUILT/.test(d.querySelector('#keysBody').textContent));
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'/', ctrlKey:true, bubbles:true}));
  ok('Ctrl+/ again toggles it shut', wrap().hidden === true);
  fire(d.querySelector('#btnKeys'), 'click');
  ok('the toolbar button opens it too', wrap().hidden === false);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  ok('Esc closes it', wrap().hidden === true);
  // Esc treats it as the TOP layer: open the palette, then the sheet over it
  fire(d.querySelector('#btnAdd'), 'click');
  fire(d.querySelector('#btnKeys'), 'click');
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  ok('Esc closes the sheet first, leaving the palette open',
     wrap().hidden === true && d.querySelector('#palWrap').hidden === false);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
}

// ── Echoes page: a grid of per-character build cards, live + persisted ──
{
  reset();
  const echoTab = () => d.querySelector('.pagenav [data-page="echoes"]');
  const card = id => d.querySelector(`.ebuild[data-ec="${id}"]`);
  const q = (id, sel) => card(id).querySelector(sel);
  fire(echoTab(), 'click');
  ok('Echoes nav opens the page', d.querySelector('#pageEcho').hidden === false &&
     d.querySelector('#pageLedger').hidden === true && echoTab().classList.contains('on'));
  ok('one build card per ledger character, shown at once', d.querySelectorAll('#esheets .ebuild').length === 3);
  ok('a card names its character and holds 5 echo columns',
     q('jinhsi', '.ehname').textContent === 'Jinhsi' &&
     card('jinhsi').querySelectorAll('.egrid .ecol').length === 5);
  ok('a fresh card shows the 12/12 budget', /12 \/ 12/.test(q('jinhsi', '.ebudget').textContent) &&
     !q('jinhsi', '.ebudget').classList.contains('over'));
  ok('no build is materialized just by viewing', w.eval('state.builds.jinhsi === undefined'));
  ok('ATK% and flat ATK read as distinct labels',
     /ATK%/.test(card('jinhsi').textContent) &&
     /\+ 150 ATK</.test(q('jinhsi', '.emval').innerHTML));

  // Sonata sets live on each ECHO — counting pieces drives the bonus
  const setSel0 = q('jinhsi', '[data-eset][data-ei="0"]');
  setSel0.value = 'Freezing Frost'; fire(setSel0, 'change');
  ok('choosing a set on one echo materializes + saves the build',
     w.eval("state.builds.jinhsi && state.builds.jinhsi.echoes[0].set === 'Freezing Frost'"));
  ok('one piece is not enough — the chip is unlit and says it needs 2',
     !q('jinhsi', '.eset').classList.contains('on') &&
     /needs 2/.test(q('jinhsi', '.eset').textContent));
  const setSel1 = q('jinhsi', '[data-eset][data-ei="1"]');
  setSel1.value = 'Freezing Frost'; fire(setSel1, 'change');
  ok('two pieces switch the 2pc on — chip lit, bonus named, count shown',
     q('jinhsi', '.eset').classList.contains('on') &&
     /×2/.test(q('jinhsi', '.eset').textContent) &&
     /\+10% Glacio DMG/.test(q('jinhsi', '.eset').textContent));
  ok('the Glacio 2pc lands in the card totals',
     /Glacio DMG/.test(q('jinhsi', '.etotals').textContent));
  // 3pc Freezing Frost + 2pc Moonlit Clouds — the split this model exists for
  const wearSet = (ei, name) => { const s = q('jinhsi', `[data-eset][data-ei="${ei}"]`); s.value = name; fire(s, 'change'); };
  wearSet(2, 'Freezing Frost'); wearSet(3, 'Moonlit Clouds'); wearSet(4, 'Moonlit Clouds');
  const chips = [...card('jinhsi').querySelectorAll('.eset')];
  ok('a 3pc + 2pc split lists both sets with counts, both lit',
     chips.length === 2 && chips.every(c => c.classList.contains('on')) &&
     /Freezing Frost/.test(chips[0].textContent) && /×3/.test(chips[0].textContent) &&
     /Moonlit Clouds/.test(chips[1].textContent) && /×2/.test(chips[1].textContent));
  // the set chip's tooltip carries the full effect text
  ok('a set chip tooltips its 2pc and 5pc effect text',
     /2pc: Glacio DMG \+10%/.test(q('jinhsi', '.eset').title) &&
     /5pc: /.test(q('jinhsi', '.eset').title));
  ok('both 2pc bonuses land: Glacio 10% and Energy Regen 100+10',
     w.eval("finalStats(state.builds.jinhsi,'jinhsi',null,null).stats.find(s=>s.key==='glacio').val") === 10 &&
     w.eval("finalStats(state.builds.jinhsi,'jinhsi',null,null).stats.find(s=>s.key==='er').val") === 110);

  // set echo 0 main to Crit DMG, add two substats
  const main0 = q('jinhsi', '[data-emain][data-ei="0"]');
  main0.value = 'cd'; fire(main0, 'change');
  const subK = q('jinhsi', '[data-esub][data-ei="0"][data-si="0"]');
  subK.value = 'cr'; fire(subK, 'change');
  const subV = q('jinhsi', '[data-eval][data-ei="0"][data-si="0"]');
  subV.value = '8.1'; fire(subV, 'change');
  ok('substat persists densified onto the build',
     w.eval("JSON.stringify(state.builds.jinhsi.echoes[0].subs) === JSON.stringify([{key:'cr',val:8.1}])"));
  ok('Crit Rate total = substat 8.1 + forte grant 8',
     /Crit Rate/.test(q('jinhsi', '.etotals').textContent) &&
     w.eval("buildTotals(state.builds.jinhsi, forteStatTotals(state.goals.find(g=>g.char==='jinhsi'),'tgt')).find(t=>t.key==='cr').val") === 16.1);

  // focus substats: toggling a chip persists and highlights matching substats
  fire(q('jinhsi', '[data-focus="cr"]'), 'click');
  ok('a focus chip persists onto the build', w.eval("state.builds.jinhsi.focus.includes('cr')"));
  ok('the active chip is marked on', q('jinhsi', '[data-focus="cr"]').classList.contains('on'));
  ok('exactly the Crit-Rate substat row is highlighted',
     card('jinhsi').querySelectorAll('.esub.focus').length === 1 &&
     q('jinhsi', '[data-esub][data-ei="0"][data-si="0"]').closest('.esub').classList.contains('focus'));
  fire(q('jinhsi', '[data-focus="cr"]'), 'click');
  ok('toggling the chip off clears the focus and the highlight',
     w.eval("!state.builds.jinhsi.focus.includes('cr')") &&
     card('jinhsi').querySelectorAll('.esub.focus').length === 0);

  // editing one card leaves the others untouched (radio groups are scoped by charId)
  ok('editing Jinhsi did not materialize a build for Phoebe', w.eval('state.builds.phoebe === undefined'));

  // the lead is positional: the FIRST echo wears a subtle side bar (.ecol.lead),
  // no LEAD tag, no radios; its name field hints "lead echo…"
  ok('the first echo has the side bar; no tag/radios; others have no bar',
     card('jinhsi').querySelectorAll('.egrid .ecol')[0].classList.contains('lead') &&
     !card('jinhsi').querySelectorAll('.egrid .ecol')[1].classList.contains('lead') &&
     card('jinhsi').querySelector('.leadtag') === null &&
     card('jinhsi').querySelector('[data-elead]') === null &&
     card('jinhsi').querySelector('.ecol[data-ei="0"] [data-ename]').placeholder === 'lead echo…');
  // no echo may hold two of the same substat — a used key drops from other rows
  const du0 = q('jinhsi', '[data-esub][data-ei="0"][data-si="0"]'); du0.value = 'cr'; fire(du0, 'change');
  const du1 = q('jinhsi', '[data-esub][data-ei="0"][data-si="1"]'); du1.value = 'cd'; fire(du1, 'change');
  const duOpts = [...q('jinhsi', '[data-esub][data-ei="0"][data-si="2"]').options].map(o => o.value);
  ok('a used substat is removed from the other rows of the same echo',
     !duOpts.includes('cr') && !duOpts.includes('cd') &&
     [...q('jinhsi', '[data-esub][data-ei="0"][data-si="0"]').options].map(o => o.value).includes('cr'));
  // cost is a compact select (just the number, no "-cost") to the LEFT of the main-stat
  ok('cost shows just the number and sits before the main-stat select',
     [...card('jinhsi').querySelector('[data-ecost][data-ei="0"]').options].map(o => o.textContent).join(',') === '1,3,4' &&
     card('jinhsi').querySelector('.ecostmain').children[0].matches('[data-ecost]') &&
     card('jinhsi').querySelector('.ecostmain').children[1].matches('[data-emain]'));
  // the editable echo name persists on the echo (saved without a re-render)
  const nm = card('jinhsi').querySelector('.ecol[data-ei="0"] [data-ename]');
  nm.value = 'Mourning Aix'; fire(nm, 'input');
  ok('typing an echo name persists onto that echo',
     w.eval("state.builds.jinhsi.echoes[0].name === 'Mourning Aix'"));

  // changing a cost resets an now-illegal main to the pool head
  const cost0 = q('jinhsi', '[data-ecost][data-ei="0"]');
  cost0.value = '1'; fire(cost0, 'change');
  ok('lowering the cost repairs a main the new cost cannot carry',
     w.eval("state.builds.jinhsi.echoes[0].cost === 1 && state.builds.jinhsi.echoes[0].main === 'hpp'"));
  ok('the budget drops below 12 and is not flagged over',
     w.eval('buildCost(state.builds.jinhsi)') === 9);

  // the build survives a save/reload round-trip (no lead field any more)
  w.eval('save(); state = sanitize(JSON.parse(localStorage.getItem(STORE_KEY))); render();');
  ok('the build round-trips through sanitize (per-echo set, positional lead)',
     w.eval("state.builds.jinhsi && state.builds.jinhsi.echoes[0].set === 'Freezing Frost' && state.builds.jinhsi.echoes[0].cost === 1 && state.builds.jinhsi.lead === undefined && state.builds.jinhsi.set === undefined"));

  // drag an echo to the front → it becomes the new lead (echoes reorder; the
  // lead is positional, so echoes[0] is simply whatever now sits first)
  const before0 = w.eval('state.builds.jinhsi.echoes[0].cost');
  fire(card('jinhsi').querySelector('.ecol[data-ei="2"] .egrip'), 'dragstart');
  fire(card('jinhsi').querySelector('.ecol[data-ei="0"]'), 'drop');
  ok('dragging an echo onto position 0 reorders it to the front (new lead)',
     w.eval('state.builds.jinhsi.echoes[0].cost === 3') && before0 !== 3);

  // a build is pruned when its character leaves the roster
  w.eval("state.builds.phoebe = freshBuild(); state.goals = state.goals.filter(g => g.char !== 'phoebe'); pruneLinks(); save(); render();");
  ok('a departing character drops its build', w.eval('state.builds.phoebe === undefined'));
  ok("but a remaining character's build is untouched", w.eval('!!state.builds.jinhsi'));
  ok('the grid now shows one fewer card', d.querySelectorAll('#esheets .ebuild').length === 2);

  // filter box narrows the grid without losing focus (input outside #esheets)
  const find = d.querySelector('#echoFind');
  find.value = 'suisui'; fire(find, 'input');
  ok('the fuzzy filter narrows the card grid',
     d.querySelectorAll('#esheets .ebuild').length === 1 &&
     d.querySelector('#esheets .ebuild').dataset.ec === 'suisui');
  reset();
}

// ── Echoes final stats: base folded with gear, weapon, graceful fallback ──
{
  reset();
  fire(d.querySelector('.pagenav [data-page="echoes"]'), 'click');
  const card = id => d.querySelector(`.ebuild[data-ec="${id}"]`);
  // Jinhsi has Lv90 base on file → a Final stats panel with real totals
  ok('a character with base data shows a Final stats panel with ATK/HP/DEF rows',
     /Final stats/.test(card('jinhsi').querySelector('.et-h').textContent) &&
     [...card('jinhsi').querySelectorAll('.etk')].map(e => e.textContent).slice(0, 3).join(',') === 'ATK,HP,DEF');
  ok('final ATK folds base + gear (well above base 412)',
     w.eval("finalStats(freshBuild(), 'jinhsi', null, forteStatTotals(state.goals.find(g=>g.char==='jinhsi'),'tgt')).stats.find(s=>s.key==='atk').val") > 412);
  // Suisui is unreleased (no base) → the gear-only fallback + a note
  ok('a character without base data falls back to Gear totals + a note',
     /Gear totals/.test(card('suisui').querySelector('.et-h').textContent) &&
     /base stats/.test(card('suisui').querySelector('.etnote').textContent));
  // link a Broadblade to Jinhsi → the finals note that the weapon is folded in
  w.eval("state.goals.push(Object.assign(newWpnGoal('verdantSummit', false), {owner:'jinhsi'})); save(); render();");
  ok('a linked weapon is folded into the finals (sub says + weapon)',
     /\+ weapon/.test(card('jinhsi').querySelector('.et-h .sub').textContent));
  ok('linking the weapon raised final ATK vs no weapon',
     w.eval("finalStats(freshBuild(),'jinhsi',{weapon:'verdantSummit'},null).stats.find(s=>s.key==='atk').val > finalStats(freshBuild(),'jinhsi',null,null).stats.find(s=>s.key==='atk').val"));
  reset();
}

dom.window.close();    // kill pending toast timers so Node exits promptly
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);