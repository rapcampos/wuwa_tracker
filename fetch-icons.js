// Fetch missing icons from the WuWa fandom wiki (the original source of the
// user's icon pack — same static.wikia CDN, same WebP-in-.png payloads).
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, 'wuwa-planner.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).slice(0, 2);
eval(blocks.join('\n;\n') + ';Object.assign(globalThis, {GAME, MATS});');

const iconSlug = name => name.toLowerCase().replace(/'/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') + '_icon';
const dest = (kind, name) => path.join(ROOT, GAME.icons.dir, GAME.icons.kinds[kind],
  (GAME.icons.overrides[name] || iconSlug(name)) + '.png');
const exists = (kind, name) => GAME.icons.exts.some(ext =>
  fs.existsSync(dest(kind, name).replace(/\.png$/, '.' + ext)));

// collect missing (skip overrides that point at existing files, e.g. exp/wexp/rover)
const want = [];
for (const ch of Object.values(GAME.characters))
  if (!exists('char', ch.name)) want.push({kind:'char', name:ch.name, title:`File:Resonator ${ch.name}.png`});
for (const w of Object.values(GAME.weapons))
  if (!exists('weapon', w.name)) want.push({kind:'weapon', name:w.name, title:`File:Weapon ${w.name}.png`});
for (const id of Object.keys(MATS))
  if (id !== 'exp' && id !== 'wexp' && !exists('mat', MATS[id].name))
    want.push({kind:'mat', name:MATS[id].name, title:`File:Item ${MATS[id].name}.png`});

const UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'};
const api = 'https://wutheringwaves.fandom.com/api.php';

(async () => {
  // resolve file titles → CDN urls in batches of 25 (API limit for anon)
  const urlByTitle = {};
  for (let i = 0; i < want.length; i += 25) {
    const batch = want.slice(i, i + 25);
    const q = `${api}?action=query&titles=${encodeURIComponent(batch.map(x => x.title).join('|'))}` +
              `&prop=imageinfo&iiprop=url&format=json`;
    const d = await (await fetch(q, {headers: UA})).json();
    for (const p of Object.values(d.query.pages))
      if (p.imageinfo) urlByTitle[p.title] = p.imageinfo[0].url;
    // API normalizes underscores/quotes; map normalized back
    for (const n of d.query.normalized || []) if (urlByTitle[n.to]) urlByTitle[n.from] = urlByTitle[n.to];
  }

  let ok = 0; const misses = [];
  for (const it of want) {
    const url = urlByTitle[it.title] || urlByTitle[it.title.replace(/_/g, ' ')];
    if (!url) { misses.push(`${it.kind}: ${it.name}  (no wiki file: ${it.title})`); continue; }
    const res = await fetch(url, {headers: UA});
    if (!res.ok) { misses.push(`${it.kind}: ${it.name}  (HTTP ${res.status})`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) { misses.push(`${it.kind}: ${it.name}  (tiny response, ${buf.length}B)`); continue; }
    fs.writeFileSync(dest(it.kind, it.name), buf);
    ok++;
    console.log(`fetched  ${it.kind.padEnd(6)} ${it.name}  →  ${path.relative(ROOT, dest(it.kind, it.name))}`);
    await new Promise(r => setTimeout(r, 300));   // be polite to the CDN
  }
  console.log(`\n${ok} fetched, ${misses.length} not found:`);
  misses.forEach(m => console.log('  MISS ' + m));
})();
