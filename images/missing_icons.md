# Missing icons checklist

Updated 2026-07-14: **nothing is missing, and nothing is a stopgap any more.**
Every character, weapon, material, element and weapon-type glyph in the
registry resolves to a local file, all of them from the fandom wiki (the icon
source of record — transparent backgrounds, 256×256 WebP payloads saved as
.png). `node fetch-icons.js` reports `0 fetched, 0 not found`.

The ten 3.5 stopgaps flagged on launch day were replaced on 2026-07-14, once
the wiki had uploaded its own files:

- **8 materials** (were Game8's framed 120×120 icons): the four Autopuppet
  Kernels, Solidarity's Loneflame, Cloudperch Seed, Skyward Glazed Heart,
  Flowborne Dream.
- **2 weapons** (were the wiki's Full-art renders): Azure Oath and
  Firstlight's Herald — the square inventory icons exist now.

Also added on 2026-07-14: the 11 **element / weapon-type glyphs** the card
meta lines use (`images/attributes/`, from `File:<Name> Icon.png`).

## Gotcha worth keeping

The wiki does not always name a file after the in-game display name. The
kernels ship in-game as "Autopuppet Kernel (LF)", but the wiki kept the beta
prefix form: `File:Item LF Autopuppet Kernel.png`. `fetch-icons.js` now carries
a `TITLE_OVERRIDES` map (display name → wiki file title) for exactly this — add
to it rather than renaming registry entries, since the registry follows the
game, not the wiki.

Titles otherwise derive as `File:Resonator <Name>.png` / `File:Weapon
<Name>.png` / `File:Item <Name>.png` / `File:<Name> Icon.png` (elements and
weapon types), with `#` and `:` stripped.
