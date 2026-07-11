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
           done: [], inv: {}, synth: true, hideUn: false, skipCE: false,
           tab: 'total', teams: [], defaults: D};
  undoStack.length = 0; clearTimeout(undoTimer);
  editIdx = null; editTpl = null; palPick = null; palSel = 0;
  farmId = null; dragIdx = null; ordDrag = null; invFilter = ''; invDirty = false;
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

// ── inventory edits refresh the goals grid on blur, not per change ──
{
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Inventory'), 'click');
  const row = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('Elegy Tacet Core'));
  const inp = row.querySelector('.invIn');
  const fill = () => d.querySelector('.goal[data-g="0"] .ready-fill').getAttribute('style');
  ok('inventory rows name their needers on hover',
     (row.querySelector('td').getAttribute('title') || '').includes('needed by'));
  inp.value = '21'; fire(inp, 'change');
  ok('a committed change alone leaves the goals grid untouched', fill().includes('width:0%'));
  fire(inp, 'blur');
  ok('leaving the field refreshes the goals grid', !fill().includes('width:0%'));
  ok('the inventory input survives the refresh (only #goals rebuilt)', inp.isConnected);
  inp.value = ''; fire(inp, 'change'); fire(inp, 'blur');
  ok('clearing + blur restores the bar', fill().includes('width:0%'));
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Total'), 'click');
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
  ok('Farm next notes the filter and drops credit tiles',
     d.querySelector('#summary .gmeta').textContent.includes('ignored') &&
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

// ── crafting applies to the cards (synth toggle), reserved tiers kept ──
{
  w.eval(`state.inv.howler0 = 99999; save(); render();`);
  const cardTile = pre => [...d.querySelectorAll('.goal[data-g="0"] .tile')]
    .find(t => (t.getAttribute('title') || '').startsWith(pre));
  ok('card crafts higher tiers out of tier-0 surplus',
     cardTile('FF Howler Core').classList.contains('done') &&
     cardTile('FF Howler Core').getAttribute('title').includes('covered'));
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Inventory'), 'click');
  const chk = d.querySelector('#synthChk');
  chk.checked = false; fire(chk, 'change');
  ok('synth off: the card shows the raw deficit again',
     !cardTile('FF Howler Core').classList.contains('done'));
  const chk2 = d.querySelector('#synthChk');
  chk2.checked = true; fire(chk2, 'change');
  ok('synth back on restores the crafted view', cardTile('FF Howler Core').classList.contains('done'));
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Total'), 'click');
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

// ── right-click / Shift+Enter add a fully maxed goal ──
{
  const tgtOf = name => w.eval(`JSON.stringify(state.goals.find(g =>
    g.char && GAME.characters[g.char].name === ${JSON.stringify(name)}).tgt)`);
  const nodesOf = name => w.eval(`JSON.stringify(state.goals.find(g =>
    g.char && GAME.characters[g.char].name === ${JSON.stringify(name)}).nodes)`);
  ok('the palette advertises the maxed add', d.querySelector('#palHint').hidden === false &&
     /right-click/.test(d.querySelector('#palHint').textContent));

  // baseline: a plain click uses the rarity template (5★ → forte 6)
  fire(d.querySelector('#btnAdd'), 'click');
  palIn.value = 'changli'; fire(palIn, 'input');
  fire([...d.querySelectorAll('#palList .pal-item')].find(x => x.textContent.includes('Changli')), 'click');
  ok('a plain click adds from the template', JSON.parse(tgtOf('Changli')).skills.join() === '6,6,6,6,6');

  // right-click: Lv90, every skill 10, every node planned
  fire(d.querySelector('#btnAdd'), 'click');
  palIn.value = 'camellya'; fire(palIn, 'input');
  [...d.querySelectorAll('#palList .pal-item')].find(x => x.textContent.includes('Camellya'))
    .dispatchEvent(new w.MouseEvent('contextmenu', {bubbles:true, cancelable:true}));
  ok('right-click adds a maxed character goal', d.querySelector('#palWrap').hidden === true &&
     JSON.parse(tgtOf('Camellya')).ord === 13 &&
     JSON.parse(tgtOf('Camellya')).skills.join() === '10,10,10,10,10');
  ok('…with every forte node at least planned',
     JSON.parse(nodesOf('Camellya')).every(row => row.every(v => v >= 1)));
  ok('…and the derived counts follow the matrix',
     JSON.parse(tgtOf('Camellya')).minor === 4 && JSON.parse(tgtOf('Camellya')).major === 4 &&
     JSON.parse(tgtOf('Camellya')).inh1 === 1 && JSON.parse(tgtOf('Camellya')).inh2 === 1);

  // Shift+Enter is the keyboard equivalent
  fire(d.querySelector('#btnAdd'), 'click');
  palIn.value = 'zani'; fire(palIn, 'input');
  palIn.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Enter', shiftKey:true, bubbles:true}));
  ok('Shift+Enter adds a maxed goal too', JSON.parse(tgtOf('Zani')).skills.join() === '10,10,10,10,10');

  // team-pick mode has no "maxed" concept
  w.eval(`openPal({t:0, s:0})`);
  ok('the hint hides in team-pick mode', d.querySelector('#palHint').hidden === true);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

  w.eval(`state.goals = state.goals.filter(g => !g.char ||
    !['Changli','Camellya','Zani'].includes(GAME.characters[g.char].name)); save(); render();`);
  ok('scratch goals removed for the rest of the suite', texts('.gname').length === 3);
}

// helper: open palette, type a query, Enter-add the top hit
const palAdd = q => {
  fire(d.querySelector('#btnAdd'), 'click');
  const p = d.querySelector('#palIn');
  p.value = q; fire(p, 'input');
  p.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
};

// ── Inventory tab (renamed from Remaining): inventory + synthesis ──
ok('tab is named Inventory, not Remaining',
   [...d.querySelectorAll('#tabs button')].some(b => b.textContent === 'Inventory') &&
   ![...d.querySelectorAll('#tabs button')].some(b => b.textContent === 'Remaining'));
fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Inventory'), 'click');
ok('inventory tab has inventory inputs', d.querySelectorAll('#summary .invIn').length > 10);
ok('synth toggle present & on', d.querySelector('#synthChk').checked === true);

// every material is listed, even ones no queued goal needs ('—' need, no Left cell)
const rrfRow = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('Roaring Rock Fist'));
ok('un-needed materials get inventory rows too',
   rrfRow && rrfRow.querySelector('.invIn') !== null &&
   rrfRow.textContent.includes('—') && rrfRow.querySelector('td[data-l]') === null);
ok('full-catalog listing dwarfs the needed set', d.querySelectorAll('#summary .invIn').length > 60);

// give 100 premium potions → EXP "have" reflects 2,000,000
const rows = [...d.querySelectorAll('#summary table.mats tr')];
const premRow = rows.find(r => r.textContent.includes('Premium Resonance Potion'));
const premIn = premRow.querySelector('.invIn');
premIn.value = '100'; fire(premIn, 'change');
ok('potion pool counts toward EXP', d.querySelector('#summary').textContent.includes('2,000,000'));
// edits patch computed cells in place — the table (and the input the user is
// tabbing into) must survive, or focus falls back to the top of the page
ok('inventory edit keeps the table DOM alive (Tab focus can move on)',
   premIn.isConnected && d.querySelector('#summary .invIn') !== null);

// boss mats fully covered show ✓
const bossRow = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('Cleansing Conch'));
const bossIn = bossRow.querySelector('.invIn');
bossIn.value = '46'; fire(bossIn, 'change');
const bossRow2 = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('Cleansing Conch'));
ok('covered material shows ✓ (row patched in place, not rebuilt)',
   bossRow2.textContent.includes('✓') && bossRow2 === bossRow);

// synthesis visibly changes a deficit: 100 spare LF Whisperin → crafts up
const lfRow = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('LF Whisperin Core'));
const lfIn = lfRow.querySelector('.invIn');
lfIn.value = '1000'; fire(lfIn, 'change');
const mfLeftOn = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('MF Whisperin Core')).textContent;
const synthChk = d.querySelector('#synthChk');
synthChk.checked = false; fire(synthChk, 'change');
const mfLeftOff = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('MF Whisperin Core')).textContent;
ok('synthesis toggle changes MF deficit', mfLeftOn.includes('✓') && !mfLeftOff.includes('✓'));

// hide un-needed: collapses the catalog to the needed set (incl. energy cores — no weapon goals yet)
const allCount = d.querySelectorAll('#summary .invIn').length;
const hideChk = d.querySelector('#hideChk');
hideChk.checked = true; fire(hideChk, 'change');
ok('hide un-needed removes catalog-only rows',
   d.querySelectorAll('#summary .invIn').length < allCount &&
   ![...d.querySelectorAll('#summary table.mats tr')].some(r => r.textContent.includes('Roaring Rock Fist')) &&
   !d.querySelector('#summary').textContent.includes('Energy Core'));
ok('needed rows survive the hide toggle',
   [...d.querySelectorAll('#summary table.mats tr')].some(r => r.textContent.includes('Cleansing Conch')) &&
   [...d.querySelectorAll('#summary table.mats tr')].some(r => r.textContent.includes('Premium Resonance Potion')));
ok('hide preference persisted', JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).hideUn === true);
const hideChk2 = d.querySelector('#hideChk');   // re-render replaced the node
hideChk2.checked = false; fire(hideChk2, 'change');
ok('untick restores the full catalog', d.querySelectorAll('#summary .invIn').length === allCount);

// ── Farm next tab ──
fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Farm next'), 'click');
ok('walk lists all goals', d.querySelectorAll('#summary .goalstat').length === 3);
ok('top unmet goal expanded with its missing mats as tiles',
   d.querySelectorAll('#summary .tiles .tile').length > 0 &&
   d.querySelector('#summary .st.miss') !== null);

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
ok('corrupt save: ords clamped, tgt ≥ cur',
   d4.querySelector('#goals .gmeta').textContent.includes('Lv 90 → Lv 90'));
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

// ── drag & drop ──
{
  reset();                                   // baseline order Jin,Pho,Sui
  ok('grips are draggable', [...d.querySelectorAll('.grip')].every(g => g.getAttribute('draggable') === 'true'));
  const order0 = texts('.gname').map(t => t.slice(0,3)).join(',');
  // drag last card (index 2) and drop on first card → moves to top (jsdom rects are 0 ⇒ "before")
  fire(d.querySelector('.grip[data-g="2"]'), 'dragstart');
  ok('dragging class applied', d.querySelector('.goal[data-g="2"]').classList.contains('dragging'));
  fire(d.querySelector('.goal[data-g="0"]'), 'drop');
  const order1 = texts('.gname').map(t => t.slice(0,3)).join(',');
  ok('drop moves goal to top', order0 === 'Jin,Pho,Sui' && order1 === 'Sui,Jin,Pho');
  // no-op drop: drag card 1 onto itself
  fire(d.querySelector('.grip[data-g="1"]'), 'dragstart');
  fire(d.querySelector('.goal[data-g="1"]'), 'drop');
  ok('self-drop is a no-op', texts('.gname').map(t => t.slice(0,3)).join(',') === 'Sui,Jin,Pho');
  // ▲▼ buttons still route correctly through moveGoal
  fire(d.querySelector('button[data-act="down"][data-g="0"]'), 'click');
  ok('▼ still works after unification', texts('.gname').map(t => t.slice(0,3)).join(',') === 'Jin,Sui,Pho');
  ok('drag order persisted', JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).goals.map(g => g.char).join(',') === 'jinhsi,suisui,phoebe');
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
  const heldTitle = dagger.getAttribute('title');
  fire(dagger, 'mouseenter');
  ok('hover opens the popover', pop().hidden === false);
  ok('it is a real fixed overlay', w.getComputedStyle(pop()).position === 'fixed');
  ok('the header carries the material text (name + amount), minus the meta suffixes',
     /^Sentinel's Dagger — /.test(pop().querySelector('.tip-h').textContent) &&
     !pop().querySelector('.tip-h').textContent.includes('needed by') &&
     !pop().querySelector('.tip-h').textContent.includes('click to log'));
  ok('one chip per needer, in queue order, each with a name',
     [...pop().querySelectorAll('.tip-chip')].map(c => c.textContent.trim()).join(',') === 'Jinhsi,Phoebe');
  ok('each chip carries the character’s avatar image (not just text)',
     [...pop().querySelectorAll('.tip-chip .tip-av')].map(im => im.getAttribute('src')).join(',') ===
       'images/characters/jinhsi_icon.png,images/characters/phoebe_icon.png');
  ok('the native title is suppressed while the popover is up (no double tooltip)',
     dagger.getAttribute('title') === null);
  fire(dagger, 'mouseleave');
  ok('leaving hides the popover and restores the native title',
     pop().hidden === true && dagger.getAttribute('title') === heldTitle);

  // a single-needer material shows just its one chip. Capture the element
  // first: mouseenter suppresses the title, so it can't be re-found by title.
  const elegy = tileBy('Elegy Tacet Core');         // Jinhsi only
  fire(elegy, 'mouseenter');
  ok('a single-user material shows one chip',
     pop().querySelectorAll('.tip-chip').length === 1 &&
     pop().querySelector('.tip-chip').textContent.trim() === 'Jinhsi');
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
  ok('weapon meta shows rarity/type', card.textContent.includes('5★ Broadblade weapon'));
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

  // Inventory tab: Weapon EXP pool with energy-core inputs, separate from potions
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Inventory'), 'click');
  const sumEl = () => d.querySelector('#summary');
  ok('weapon EXP row present', sumEl().textContent.includes('Weapon EXP') && sumEl().textContent.includes('2,692,400'));
  const coreRow = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('Premium Energy Core'));
  ok('energy core inventory input present', coreRow && coreRow.querySelector('.invIn') !== null);
  const coreIn = coreRow.querySelector('.invIn');
  coreIn.value = '100'; fire(coreIn, 'change');       // 100×20k = 2,000,000 wexp
  ok('core pool counts toward weapon EXP only', sumEl().textContent.includes('692,400'));

  // Farm next walks weapon goals too
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Farm next'), 'click');
  ok('walk lists char + weapon goals', d.querySelectorAll('#summary .goalstat').length === 4);
  ok('weapon row in walk shows its name', sumEl().textContent.includes('Ages of Harvest'));

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
  ok('corrupt save: weapon ords clamped, tgt ≥ cur',
     dW.querySelector('#goals .gmeta').textContent.includes('Lv 90 → Lv 90'));
  ok('corrupt save: core inventory floored',
     JSON.parse(domW.window.localStorage.getItem('wuwa-planner-v1')).inv.wexp2 === 3);
}

// ── Inventory tab is a full stock editor even with an empty queue ──
{
  const domE = new JSDOM(html, {runScripts:'outside-only', url:'https://localhost/'});
  domE.window.localStorage.setItem('wuwa-planner-v1', '{"goals":[],"inv":{"exp4":5},"tab":"left"}');
  domE.window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n'));
  const dE = domE.window.document;
  ok('inventory tab lists every material with no goals queued',
     dE.querySelectorAll('#summary .invIn').length > 60);
  ok('stock loads into the inputs with no goals queued',
     [...dE.querySelectorAll('#summary .invIn')].some(i => i.value === '5'));
  const totBtn = [...dE.querySelectorAll('#tabs button')].find(b => b.textContent === 'Total');
  totBtn.dispatchEvent(new domE.window.Event('click', {bubbles:true}));
  ok('other tabs keep the empty-queue note',
     dE.querySelector('#summary .empty') !== null);
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

  // Max goal: current snaps to target, planned nodes become owned
  fire(mbox().querySelector('[data-maxgoal]'), 'click');
  ok('max goal: current level matches target', sCard().textContent.includes('Lv 90 → Lv 90'));
  ok('max goal: current skills match target',
     [...sCard().querySelectorAll('.mini .sk')].every(s => s.textContent === '10→10'));
  ok('max goal: every planned node now owned',
     sCard().querySelectorAll('.mini .node.own').length === 10 &&
     sCard().querySelectorAll('.mini .node.plan').length === 0);
  ok('max goal: card needs nothing and offers ✓',
     sCard().textContent.includes('Nothing needed') &&
     sCard().querySelector('button[data-act="done"]') !== null);

  // editor is lean now: no bottom legend, no save-as-default (Templates owns that)
  ok('goal editor: no bottom legend, no save-as-default',
     mbox().querySelector('.ftree-legend') === null && mbox().querySelector('[data-setdef]') === null);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  fire(d.querySelector('button[data-act="del"][data-g="4"]'), 'click');   // remove sanhua
  // weapon pop-up keeps Max and gains Max goal
  fire(d.querySelector('button[data-act="edit"][data-g="3"]'), 'click');
  ok('weapon pop-up keeps Max', mbox().querySelector('[data-max]') !== null);
  fire(mbox().querySelector('[data-maxgoal]'), 'click');
  ok('weapon max goal: current level snaps to target',
     mbox().querySelector('select[data-side="cur"][data-f="ord"]').value ===
     mbox().querySelector('select[data-side="tgt"][data-f="ord"]').value);
  const wCur = mbox().querySelector('select[data-side="cur"][data-f="ord"]');
  wCur.value = '0'; fire(wCur, 'change');            // back to a full plan for later blocks
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
  ok('completed row: name + DONE badge + restore/forget buttons',
     d.querySelector('#summary .goalstat') !== null &&
     d.querySelector('#summary').textContent.includes('Phoebe') &&
     d.querySelector('#summary .st.ready') !== null &&
     d.querySelector('#summary [data-undone]') !== null &&
     d.querySelector('#summary [data-rmdone]') !== null);
  ok('completed row is a single line: level + forte levels + lit node indicator',
     d.querySelector('#summary .mini') === null &&
     d.querySelector('#summary .goalstat .gmeta').textContent.includes('forte all 6') &&
     d.querySelector('#summary .goalstat .nodechk.on') !== null &&
     (d.querySelector('#summary .nodechk').getAttribute('title') || '').includes('cover'));
  // dropping below the template's node plan unlights the indicator
  w.eval('state.done[0].nodes[1][0] = 0; syncNodeCounts(state.done[0]); save(); render();');
  ok('indicator goes dark below the template plan; tooltip names the gap',
     d.querySelector('#summary .nodechk') !== null &&
     d.querySelector('#summary .nodechk.on') === null &&
     d.querySelector('#summary .nodechk').getAttribute('title').includes('1 major stat node'));
  w.eval('state.done[0].nodes[1][0] = 2; syncNodeCounts(state.done[0]); save(); render();');
  ok('re-owning the node relights the indicator', d.querySelector('#summary .nodechk.on') !== null);
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
  // ✕ forgets the record and frees the character for re-adding
  const phCard2 = [...d.querySelectorAll('#goals .goal')].find(c => c.textContent.includes('Phoebe'));
  fire(phCard2.querySelector('button[data-act="done"]'), 'click');
  fire(d.querySelector('#summary [data-rmdone]'), 'click');
  ok('✕ forgets the completed goal',
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).done.length === 0);
  fire(d.querySelector('#btnAdd'), 'click');
  const pIn2 = d.querySelector('#palIn');
  pIn2.value = 'phoebe'; fire(pIn2, 'input');
  ok('forgotten char is addable again', d.querySelector('#palList').textContent.includes('Phoebe'));
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
  ok('done tab persists and renders its rows', dD.querySelectorAll('#summary .goalstat').length === 2);
  ok('char done rows carry the node indicator, weapon rows do not',
     dD.querySelectorAll('#summary .nodechk').length === 1 &&
     dD.querySelector('#summary .goalstat .nodechk') !== null);
  ok('a bare done record (no owned nodes) reads dark against the template',
     dD.querySelector('#summary .nodechk.on') === null);
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
  ok('roster chips: one per character (weapons excluded), none spent',
     nChars >= 2 && d.querySelectorAll('#teams .rchip').length === nChars &&
     d.querySelectorAll('#teams .rchip.spent').length === 0);

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
     d.querySelector('#palIn').placeholder.includes('Team 1'));
  fire(d.querySelector('#palList .pal-item'), 'click');
  const teamSave = () => JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).teams;
  ok('picking fills the slot and persists',
     d.querySelectorAll('#teams .slot.empty').length === 2 &&
     teamSave()[0].chars.filter(Boolean).length === 1);
  ok('used chip dims (energy 1 spent)', d.querySelectorAll('#teams .rchip.spent').length === 1);

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

  // clicking the filled slot clears it and refunds the energy
  fire(d.querySelector('#teams .slot:not(.empty)'), 'click');
  ok('clicking a filled slot clears it',
     d.querySelectorAll('#teams .slot.empty').length === 3 &&
     d.querySelectorAll('#teams .rchip.spent').length === 0);

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
  ok('tiles carry name + need in the hover title',
     tileOf('Elegy Tacet Core') !== undefined && tileOf('Premium Resonance Potion') !== undefined &&
     tileOf('Premium Resonance Potion').getAttribute('title').includes('EXP pool'));
  // game-style sort: rarity descends within each section (gold first)
  {
    const section = label => [...d.querySelectorAll('#invGrid .cat')]
      .find(c => c.textContent === label).nextElementSibling;
    const exp = [...section('EXP').querySelectorAll('.itile')];
    ok('EXP section leads with the premium (gold) items',
       exp[0].classList.contains('r5') && exp[exp.length - 1].classList.contains('r2'));
    const forge = [...section('Forgery').querySelectorAll('.itile')];
    ok('Forgery section descends by rarity like the game inventory',
       forge[0].classList.contains('r5') && forge[forge.length - 1].classList.contains('r2') &&
       forge.every((t, i) => i === 0 || +forge[i - 1].className.match(/r(\d)/)[1] >= +t.className.match(/r(\d)/)[1]));
  }
  ok('grid tooltips name the goals that need an item',
     [...d.querySelectorAll('#invGrid .itile')].some(t => (t.getAttribute('title') || '').includes('needed by')));
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
  // hide un-needed filters the grid (same persisted state.hideUn as the tab)
  const nAll = d.querySelectorAll('#invGrid .itile').length;
  const hid = d.querySelector('#ihideChk');
  hid.checked = true; fire(hid, 'change');
  ok('hide un-needed shrinks the grid and persists',
     d.querySelectorAll('#invGrid .itile').length < nAll &&
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).hideUn === true);
  const hid2 = d.querySelector('#ihideChk');
  hid2.checked = false; fire(hid2, 'change');
  ok('untick restores the catalog', d.querySelectorAll('#invGrid .itile').length === nAll);
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

// ── upgrade transactions: editor buttons spend inventory, one Ctrl+Z away ──
{
  reset();
  // Phoebe (index 1, not the top of the queue) at Lv20, empty stock
  w.eval(`Object.keys(state.inv).forEach(k => delete state.inv[k]);
    state.goals.find(x => x.char === 'phoebe').cur.ord = 1;
    save(); render();`);
  const gi = w.eval(`state.goals.findIndex(x => x.char === 'phoebe')`);
  fire(d.querySelector(`button[data-act="edit"][data-g="${gi}"]`), 'click');
  const rows = () => [...mbox().querySelectorAll('.upg-row')];
  ok('editor grows an upgrade section; next level step leads',
     mbox().querySelector('.upg') !== null && rows()[0].textContent.includes('Lv 20 → Lv 20 ✦'));
  ok('unaffordable step: disabled button, shortfall in the tooltip',
     rows()[0].querySelector('[data-upg]').disabled === true &&
     rows()[0].querySelector('[data-upg]').getAttribute('title').includes('Missing:') &&
     rows()[0].querySelector('[data-upg]').getAttribute('title').includes('LF Whisperin Core'));
  ok('node dependency: planned lowers offered, uppers gated on owned lowers',
     rows().some(r => r.textContent.includes('Minor node')) &&
     !rows().some(r => r.textContent.includes('Major node')) &&
     rows().some(r => r.textContent.includes('Inherent Ⅰ')) &&
     !rows().some(r => r.textContent.includes('Inherent Ⅱ')));

  // fund the ascension exactly (anchor: 4× LF Whisperin Core + 5,000 credits)
  w.eval(`state.inv.whisperin0 = 4; state.inv.credits = 5000; save(); render();`);
  ok('funded step enables', rows()[0].querySelector('[data-upg]').disabled === false);
  ok('queue priority never gates spending — this goal is not at the top of the queue', gi > 0);
  fire(rows()[0].querySelector('[data-upg]'), 'click');
  ok('purchase advances current and drains the exact cost',
     w.eval(`state.goals[${gi}].cur.ord`) === 2 &&
     w.eval('state.inv.whisperin0 === undefined && state.inv.credits === undefined') === true);
  ok('purchase arms the undo toast with the goal name',
     d.querySelector('#undoBar').hidden === false &&
     d.querySelector('#undoMsg').textContent.includes('Phoebe'));
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true}));
  ok('Ctrl+Z refunds both the level and the materials',
     w.eval(`state.goals[${gi}].cur.ord`) === 1 && w.eval('state.inv.whisperin0') === 4);

  // buy Inherent Ⅰ (anchor: 3× T2 forge + 3× T2 common + 1 weekly + 10,000)
  w.eval(`{ const ch = GAME.characters.phoebe;
    state.inv[ch.forge + '1'] = 3; state.inv[ch.common + '1'] = 3;
    state.inv['wk:' + ch.weekly] = 1; state.inv.credits = 10000; save(); render(); }`);
  const inhRow = () => rows().find(r => r.textContent.includes('Inherent Ⅰ'));
  ok('funded node step enables', inhRow().querySelector('[data-upg]').disabled === false);
  fire(inhRow().querySelector('[data-upg]'), 'click');
  ok('node purchase flips planned → owned and spends everything',
     w.eval(`state.goals[${gi}].nodes[0][2]`) === 2 &&
     w.eval('state.inv.credits === undefined') === true);
  ok('Inherent Ⅱ becomes purchasable once Ⅰ is owned',
     rows().some(r => r.textContent.includes('Inherent Ⅱ')));

  // crafting-aware spending: hold a tier-1 line ONLY as tier-0 ×3
  w.eval(`{ Object.keys(state.inv).forEach(k => delete state.inv[k]);
    state.synth = true;                               // reset() leaves it on; be explicit anyway
    const g = state.goals[${gi}];
    g.cur.ord = 3;                                    // next step: rank-2 ascension
    const cost = costForGoal({char:'phoebe', cur:g.cur, tgt:{...g.cur, ord:4, skills:[...g.cur.skills]}});
    window.__t1 = null;
    for(const [id, q] of Object.entries(cost)){
      if(id === 'exp') state.inv.exp4 = Math.ceil(q / 20000);
      else if(MATS[id] && MATS[id].family && MATS[id].tier === 1){
        state.inv[MATS[id].family + '0'] = q * 3; window.__t1 = id;
      } else state.inv[id] = q;
    }
    save(); render(); }`);
  ok('craft scenario prepared (a tier-1 line held only as tier-0 ×3)', w.eval('window.__t1') !== null);
  ok('synth on: the step is affordable through crafting, and says so',
     rows()[0].querySelector('[data-upg]').disabled === false &&
     rows()[0].querySelector('[data-upg]').getAttribute('title').includes('crafts lower tiers'));
  fire(rows()[0].querySelector('[data-upg]'), 'click');
  ok('purchase crafts the tier-0 stock away and advances',
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
  const rows = () => [...d.querySelectorAll('#farmList .frow')];
  const names = () => rows().map(r => r.querySelector('.fname').textContent);
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

  // the left/covered column is patched in place as stock changes
  {
    const need = w.eval('totalBag(state.goals)[FARM[1]] || 0');
    const inp = rows()[1].querySelector('.fqty');
    inp.value = String(need + 5); fire(inp, 'change');
    ok('typing an exact number saves it', stockOf(names()[1]) === need + 5);
    ok('covering a tier flips its column to ✓', need === 0 ||
       rows()[1].querySelector('.fneed').textContent.startsWith('✓'));
    inp.value = '0'; fire(inp, 'change');
    ok('emptying it reports what is missing again', need === 0 ||
       rows()[1].querySelector('.fneed').textContent === `${need.toLocaleString('en-US')} left`);
  }

  // closing applies everywhere, exactly like the stock grid
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

  // the Inventory tab's row icons are the same door
  {
    fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Inventory'), 'click');
    const cell = d.querySelector('#summary td.matcell');
    ok('inventory rows advertise the click', /click to log drops/.test(cell.getAttribute('title')));
    const nm = cell.getAttribute('title').split(' · ')[0];
    fire(cell, 'click');
    ok('an inventory row icon opens the farm pop-up', farm().hidden === false);
    ok('…on the clicked material’s family', names().includes(nm));
    d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Total'), 'click');
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
     dT.querySelectorAll('#teams .rchip.spent').length === 2);
  ok('old saves without teams default to none (jsdom main dom booted clean)', Array.isArray(savedT.teams));
}

dom.window.close();    // kill pending toast timers so Node exits promptly
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);