# Missing icons checklist

Updated 2026-07-10 (3.5 launch day, second pass): **nothing is missing** —
every character, weapon, and material in the registry now has a local file.

Three groups are stopgaps from non-wiki sources, worth swapping when the
fandom wiki (the icon source of record — transparent backgrounds, matches
the rest of the pack) uploads its files. To swap: delete the local file(s)
and re-run `node fetch-icons.js`.

- **8 material icons from Game8** (img.game8.co, 120×120, framed style —
  visibly boxier than the wiki icons): autopuppet_kernel_{lf,mf,hf,ff},
  solidaritys_loneflame, cloudperch_seed, skyward_glazed_heart,
  flowborne_dream. The wiki had zero Item files for 3.5 materials on
  launch day (its own pages show red file links).
- **2 weapon icons from the wiki's Full-art renders** ("Weapon <Name>
  Full.png" — the square inventory versions weren't uploaded yet):
  azure_oath, firstlights_herald.
- Fetched normally: yangyang_xuanling (wiki file drops the ':' —
  fetch-icons.js strips '#' and ':' from titles now).

Suisui's banner (2026-07-30) is a good moment to re-check the wiki for
proper versions of all ten.
