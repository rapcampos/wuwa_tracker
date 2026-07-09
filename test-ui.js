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

// ── initial render: summary left, read-only status cards right ──
ok('3 goal cards rendered', d.querySelectorAll('.goal').length === 3);
ok('priority order J/P/S', texts('.gname').join(',').startsWith('Jinhsi,Phoebe,Suisui'));
ok('Suisui has beta badge', d.querySelectorAll('.badge').length === 1);
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

// grand total sanity: 3 default-target builds (Lv90 · forte 6 · all nodes) →
// credits 3 × 1,803,300 = 5,409,900; Sentinel's Dagger = 6+6 = 12
const creditTile = d.querySelector('#summary .tile[title="Shell Credit — 5,409,900"]');
ok('total credits 3× default build (exact in title, 5.41M on tile)',
   creditTile !== null && creditTile.textContent.includes('5.41M') && !creditTile.textContent.includes('Shell Credit'));
ok("shared weekly (Sentinel's Dagger) merged to 12",
   d.querySelector(`#summary .tile[title="Sentinel's Dagger — 12"]`) !== null);
const expTile = [...d.querySelectorAll('#summary .tile')].find(t => t.title.startsWith('Resonator EXP'));
ok('total EXP 3× full build with potion plan in tooltip',
   expTile && expTile.title.includes('7,314,000') && expTile.title.includes('≈') && expTile.textContent.includes('7.31M'));
ok('tiles carry rarity grounds', d.querySelector('#summary .tile.r5') !== null &&
   d.querySelector('#summary .tile.r2') !== null && d.querySelector('#goals .tile.r4') !== null);

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
fire(d.querySelector('#btnAdd'), 'click');
const addBtn = d.querySelector('#addMenu button[data-c="suisui"]');
ok('add menu offers every un-queued char (incl. Suisui)',
   addBtn !== null && d.querySelectorAll('#addMenu button[data-c]').length ===
     w.eval('Object.keys(GAME.characters).length') - 2);   // Jinhsi + Phoebe still queued
ok('add menu offers every seeded weapon',
   d.querySelectorAll('#addMenu button[data-w]').length === w.eval('Object.keys(GAME.weapons).length'));
fire(addBtn, 'click');
ok('goal re-added at end', texts('.gname')[2].startsWith('Suisui'));
ok('add button stays enabled (weapons are repeatable)', d.querySelector('#btnAdd').disabled === false);

// ── Remaining tab: inventory + synthesis ──
fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Remaining'), 'click');
ok('remaining tab has inventory inputs', d.querySelectorAll('#summary .invIn').length > 10);
ok('synth toggle present & on', d.querySelector('#synthChk').checked === true);

// give 100 premium potions → EXP "have" reflects 2,000,000
const rows = [...d.querySelectorAll('#summary table.mats tr')];
const premRow = rows.find(r => r.textContent.includes('Premium Resonance Potion'));
const premIn = premRow.querySelector('.invIn');
premIn.value = '100'; fire(premIn, 'change');
ok('potion pool counts toward EXP', d.querySelector('#summary').textContent.includes('2,000,000'));

// boss mats fully covered show ✓
const bossRow = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('Cleansing Conch'));
const bossIn = bossRow.querySelector('.invIn');
bossIn.value = '46'; fire(bossIn, 'change');
const bossRow2 = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('Cleansing Conch'));
ok('covered material shows ✓', bossRow2.textContent.includes('✓'));

// synthesis visibly changes a deficit: 100 spare LF Whisperin → crafts up
const lfRow = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('LF Whisperin Core'));
const lfIn = lfRow.querySelector('.invIn');
lfIn.value = '1000'; fire(lfIn, 'change');
const mfLeftOn = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('MF Whisperin Core')).textContent;
const synthChk = d.querySelector('#synthChk');
synthChk.checked = false; fire(synthChk, 'change');
const mfLeftOff = [...d.querySelectorAll('#summary table.mats tr')].find(r => r.textContent.includes('MF Whisperin Core')).textContent;
ok('synthesis toggle changes MF deficit', mfLeftOn.includes('✓') && !mfLeftOff.includes('✓'));

// ── Farm next tab ──
fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Farm next'), 'click');
ok('walk lists all goals', d.querySelectorAll('#summary .goalstat').length === 3);
ok('top unmet goal expanded with its missing mats as tiles',
   d.querySelectorAll('#summary .tiles .tile').length > 0 &&
   d.querySelector('#summary .st.miss') !== null);

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
  // convention: character avatar + material rows resolve to slugged filenames
  const av = d.querySelector('.goal[data-g="0"] .avatar img.__ico');
  ok('avatar icon uses slug (phoebe first after reorder)', av && av.getAttribute('src') === 'images/characters/phoebe_icon.png');
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
}

// ── drag & drop ──
{
  ok('grips are draggable', [...d.querySelectorAll('.grip')].every(g => g.getAttribute('draggable') === 'true'));
  const order0 = texts('.gname').map(t => t.slice(0,3)).join(',');
  // drag last card (index 2) and drop on first card → moves to top (jsdom rects are 0 ⇒ "before")
  fire(d.querySelector('.grip[data-g="2"]'), 'dragstart');
  ok('dragging class applied', d.querySelector('.goal[data-g="2"]').classList.contains('dragging'));
  fire(d.querySelector('.goal[data-g="0"]'), 'drop');
  const order1 = texts('.gname').map(t => t.slice(0,3)).join(',');
  ok('drop moves goal to top', order0 === 'Pho,Jin,Sui' && order1 === 'Sui,Pho,Jin');
  // no-op drop: drag card 1 onto itself
  fire(d.querySelector('.grip[data-g="1"]'), 'dragstart');
  fire(d.querySelector('.goal[data-g="1"]'), 'drop');
  ok('self-drop is a no-op', texts('.gname').map(t => t.slice(0,3)).join(',') === 'Sui,Pho,Jin');
  // ▲▼ buttons still route correctly through moveGoal
  fire(d.querySelector('button[data-act="down"][data-g="0"]'), 'click');
  ok('▼ still works after unification', texts('.gname').map(t => t.slice(0,3)).join(',') === 'Pho,Sui,Jin');
  ok('drag order persisted', JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).goals.map(g => g.char).join(',') === 'phoebe,suisui,jinhsi');
}

// ── forte node grid in the pop-up (2×5 matrix with column dependencies) ──
{
  fire(d.querySelector('button[data-act="edit"][data-g="1"]'), 'click');
  const tree = mbox().querySelector('.ftree');
  ok('pop-up game view: 5 columns × (2 nodes + 2 skill selects)', tree &&
     tree.querySelectorAll('.node').length === 10 &&
     tree.querySelectorAll('.fcol').length === 5 &&
     tree.querySelectorAll('.link').length === 5 &&
     tree.querySelectorAll('select').length === 10);
  ok('tree shape: 4 minors, 4 majors, 2 inherents',
     tree.querySelectorAll('.node.minor').length === 4 &&
     tree.querySelectorAll('.node.major').length === 4 &&
     tree.querySelectorAll('.node.inh').length === 2);
  ok('fresh→maxed default shows all planned', [...tree.querySelectorAll('.node')].every(n => n.classList.contains('plan')));

  const cell = (r, c) => mbox().querySelector(`.node[data-r="${r}"][data-c="${c}"]`);
  const saved = () => JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).goals[1];

  // cascade down: owning a top node pulls its bottom node to owned
  fire(cell(1, 0), 'click');                       // top col0: plan → own
  let g1 = saved();
  ok('top→own cascades bottom→own', g1.nodes[1][0] === 2 && g1.nodes[0][0] === 2);
  ok('derived counts follow cascade', g1.cur.major === 1 && g1.cur.minor === 1);

  // cascade up: skipping a bottom node clears its top node
  fire(cell(0, 0), 'click');                       // bottom col0: own → skip
  g1 = saved();
  ok('bottom→skip cascades top→skip', g1.nodes[0][0] === 0 && g1.nodes[1][0] === 0);
  ok('counts drop on both rows', g1.tgt.major === 3 && g1.tgt.minor === 3);

  // top can sit below bottom: bottom owned, top planned is legal
  fire(cell(0, 1), 'click');                       // bottom col1: plan → own
  g1 = saved();
  ok('bottom owned + top planned is legal', g1.nodes[0][1] === 2 && g1.nodes[1][1] === 1);

  // inherent ordering: Ⅱ owned pulls Ⅰ owned; skipping Ⅰ clears Ⅱ
  fire(cell(1, 2), 'click');                       // Ⅱ: plan → own
  g1 = saved();
  ok('Passive Ⅱ owned requires Ⅰ owned', g1.cur.inh2 === 1 && g1.cur.inh1 === 1 && g1.nodes[0][2] === 2);
  fire(cell(0, 2), 'click');                       // Ⅰ: own → skip
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
  // add via the weapons section of the menu (queue is Pho,Sui,Jin at this point)
  fire(d.querySelector('#btnAdd'), 'click');
  ok('menu lists all seeded weapons', d.querySelectorAll('#addMenu button[data-w]').length ===
     w.eval('Object.keys(GAME.weapons).length'));
  fire(d.querySelector('#addMenu button[data-w="agesOfHarvest"]'), 'click');
  ok('weapon goal appended', texts('.gname')[3] === 'Ages of Harvest');
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
  fire(d.querySelector('#btnAdd'), 'click');
  fire(d.querySelector('#addMenu button[data-w="agesOfHarvest"]'), 'click');
  ok('duplicate weapon goal allowed', texts('.gname').filter(t => t === 'Ages of Harvest').length === 2);
  // deleting the goal being edited closes the pop-up
  fire(d.querySelector('button[data-act="edit"][data-g="4"]'), 'click');
  fire(d.querySelector('button[data-act="del"][data-g="4"]'), 'click');
  ok('deleting the edited goal closes the pop-up', d.querySelector('#modalWrap').hidden === true);

  // beta badge rides on beta weapons
  fire(d.querySelector('#btnAdd'), 'click');
  fire(d.querySelector('#addMenu button[data-w="firstlightsHerald"]'), 'click');
  ok('beta weapon carries the badge', d.querySelector('.goal[data-g="4"] .badge') !== null);
  fire(d.querySelector('button[data-act="del"][data-g="4"]'), 'click');

  // Remaining tab: Weapon EXP pool with energy-core inputs, separate from potions
  fire([...d.querySelectorAll('#tabs button')].find(b => b.textContent === 'Remaining'), 'click');
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

// ── per-rarity default goals + Max button ──
{
  // 4★ default template: Lv80, forte 6, all 8 nodes + both passives planned
  fire(d.querySelector('#btnAdd'), 'click');
  fire(d.querySelector('#addMenu button[data-c="sanhua"]'), 'click');
  const sCard = () => d.querySelector('.goal[data-g="4"]');
  ok('4★ default target: Lv 1 → Lv 80', sCard().textContent.includes('Lv 1 → Lv 80'));
  ok('4★ default: forte 6 on mini tree',
     [...sCard().querySelectorAll('.mini .sk')].every(s => s.textContent === '1→6'));
  ok('4★ default: all nodes + passives planned',
     sCard().querySelectorAll('.mini .node.plan').length === 10);

  // Max button: target → Lv90 / skills 10 / every node at least planned
  fire(d.querySelector('button[data-act="edit"][data-g="4"]'), 'click');
  fire(mbox().querySelector('[data-max]'), 'click');
  ok('max: level target 90', sCard().textContent.includes('Lv 1 → Lv 90'));
  ok('max: skills to 10', [...sCard().querySelectorAll('.mini .sk')].every(s => s.textContent === '1→10'));
  ok('max: pop-up stays open, selects follow',
     d.querySelector('#modalWrap').hidden === false &&
     mbox().querySelector('select[data-side="tgt"][data-f="ord"]').value === '13');

  // Save as 4★ default → new 4★ goals start from the saved target
  const s0t = mbox().querySelector('select[data-g="4"][data-side="tgt"][data-f="s0"]');
  s0t.value = '8'; fire(s0t, 'change');
  fire(mbox().querySelector('[data-setdef]'), 'click');
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  fire(d.querySelector('button[data-act="del"][data-g="4"]'), 'click');
  fire(d.querySelector('#btnAdd'), 'click');
  fire(d.querySelector('#addMenu button[data-c="yuanwu"]'), 'click');
  const yCard = d.querySelector('.goal[data-g="4"]');
  ok('saved default applies to new 4★ goals',
     yCard.textContent.includes('Lv 1 → Lv 90') && yCard.querySelector('.mini .sk').textContent === '1→8');
  ok('default persisted in the save',
     JSON.parse(w.localStorage.getItem('wuwa-planner-v1')).defaults['4'].skills[0] === 8);
  // weapon pop-up gets Max but no default button
  fire(d.querySelector('button[data-act="edit"][data-g="3"]'), 'click');
  ok('weapon pop-up: Max yes, default no',
     mbox().querySelector('[data-max]') !== null && mbox().querySelector('[data-setdef]') === null);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  fire(d.querySelector('button[data-act="del"][data-g="4"]'), 'click');
}

// ── bulk skill ±1 buttons ──
{
  fire(d.querySelector('button[data-act="edit"][data-g="1"]'), 'click');   // Suisui: cur 1s, tgt 6s
  const val = (side, f) => mbox().querySelector(`select[data-side="${side}"][data-f="${f}"]`).value;
  const SK = ['s0','s1','s2','s3','s4'];
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
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  ok('weapon pop-up has no bulk buttons', (() => {
    fire(d.querySelector('button[data-act="edit"][data-g="3"]'), 'click');
    const none = mbox().querySelector('[data-bulk]') === null;
    d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    return none;
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);