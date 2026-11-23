# Themes

Scia wears one of nine themes, chosen in Settings; Black Tie is the default. Each is one of the "Minimal" palettes of color-hex.com — [palette 5244](https://www.color-hex.com/color-palette/5244) and the eight it lists as related (#52). Which variant a theme shows, light or dark, is the system's choice.

A palette is five flat colours; a theme is the thirteen tokens of `apps/renderer/src/themes.css`, in two variants. This page says, token by token, what each theme took from its palette and what it had to make: **bold** is a colour of the palette as the page has it, the rest are tones of the palette's own hues (the same hue, lighter or darker, less saturated for the grounds).

Three things no palette gives, in any theme:

- **Both variants.** No palette has a light set and a dark set of grounds: at least one variant's grounds are made.
- **The red of a failure** (`destructive`). Only Space has a red: too dark to be seen on a dark ground, and on a light one too close to the near-black of the text to say that something failed.
- **Every pair at WCAG 2.2 AA.** The numbers below are computed, and a spec holds them (`apps/desktop/src/theme-colours.test.ts`): 4.5:1 for text on every ground it is written on, 3:1 for a bar on its track, an icon, the scrollbar's thumb, the window's own buttons and the focus outline on every ground it is drawn on.

Two tokens are not held as the others are, and say so here so that the next theme does not have to guess. `border` is two things. It is the ground of a text button under the pointer, where the spec holds the text on it at 4.5:1 (5.92:1 at the lowest, Brick light). And it is the boundary of the two fields, held to no ratio as a line: between 1.39:1 and 2.33:1 against the page, 1.55:1 to 1.99:1 on the dialog's surface. So a field is never known by its line: WCAG 1.4.11 asks 3:1 of what identifies a control, and something inside the field, held at the contrast of text, carries it (the owner, #66). The add bar's field is known by its icon and its placeholder, both `muted-foreground` and held — not by its fill, which is not held: its `surface` on the page is 1.08:1 to 1.25:1. The key's field of a service has no icon and no fill: its placeholder, "Paste your API key", in `muted-foreground` on the dialog's `surface`, held at 4.5:1 by the spec, draws it at rest. A field that comes after, with nothing else, has the same. `overlay` is the one token held to no contrast: the veil a dialog draws over the page, the darkest colour of the theme at 40 % on light — the palette's own where it has one — and black at 60 % on dark.

Selected text is not a token: it is `accent-foreground` on `accent`, in every theme, and the same spec holds that.

Captures of every theme, from the real app: [`themes/`](./themes/); the default one is the captures of [`README.md`](./README.md).

## Black Tie

[Palette 5244](https://www.color-hex.com/color-palette/5244): `#202020` `#e3e3e3` `#424242` `#111111`.

Monochrome, by the owner’s decision: the accent is the palette’s own light grey on dark and its dark grey on light, and the only colour left is the red of a failure. `#424242` is 1.88:1 on `#111111`, so it cannot be the secondary text of the dark variant: it is the field’s boundary there, and the secondary text of the light one. A paused bar is told from a running one by tone alone: 2.09:1 between them on dark, 1.62:1 on light.

| Token                    | Dark              | Light                 |
| ------------------------ | ----------------- | --------------------- |
| `background`             | **`#111111`**     | **`#e3e3e3`**         |
| `surface`                | **`#202020`**     | `#f3f3f3`             |
| `surface-hover`          | `#282828`         | `#ebebeb`             |
| `tonal`                  | `#333333`         | `#d3d3d3`             |
| `foreground`             | **`#e3e3e3`**     | **`#111111`**         |
| `muted-foreground`       | `#9e9e9e`         | **`#424242`**         |
| `accent`                 | **`#e3e3e3`**     | **`#202020`**         |
| `accent-foreground`      | **`#111111`**     | **`#e3e3e3`**         |
| `destructive`            | `#ff8585`         | `#b42828`             |
| `destructive-foreground` | `#2b0707`         | `#ffffff`             |
| `border`                 | **`#424242`**     | `#bdbdbd`             |
| `ring`                   | **`#e3e3e3`**     | **`#202020`**         |
| `overlay`                | `#000000` at 60 % | **`#111111`** at 40 % |

Lowest contrast — text: 4.72:1 dark, 5.00:1 light; marks: 5.38:1 dark, 4.28:1 light.

## Brick

[Palette 5254](https://www.color-hex.com/color-palette/5254): `#dfccaf` `#b4a389` `#bf390b` `#902e15` `#511301`.

The accent is the palette’s brick red, lightened on dark, where `#bf390b` is too dim against the tonal ground. Because the accent is a red, the failure colour is moved toward crimson so that a failed bar and a running one stay apart.

| Token                    | Dark              | Light                 |
| ------------------------ | ----------------- | --------------------- |
| `background`             | `#190804`         | **`#dfccaf`**         |
| `surface`                | `#26100a`         | `#f2e4d0`             |
| `surface-hover`          | `#2e1711`         | `#e9d8c0`             |
| `tonal`                  | `#3e231c`         | `#d3c0a1`             |
| `foreground`             | **`#dfccaf`**     | **`#511301`**         |
| `muted-foreground`       | **`#b4a389`**     | `#5f3f35`             |
| `accent`                 | `#f16842`         | **`#bf390b`**         |
| `accent-foreground`      | `#190804`         | `#ffffff`             |
| `destructive`            | `#ff7a9c`         | `#a3123f`             |
| `destructive-foreground` | `#2b0712`         | `#ffffff`             |
| `border`                 | `#51352d`         | **`#b4a389`**         |
| `ring`                   | `#f16842`         | **`#bf390b`**         |
| `overlay`                | `#000000` at 60 % | **`#511301`** at 40 % |

Lowest contrast — text: 5.84:1 dark, 4.93:1 light; marks: 4.65:1 dark, 3.11:1 light.

## Road Trip

[Palette 5240](https://www.color-hex.com/color-palette/5240): `#727272` `#565656` `#474747` `#d2b746` `#2f2f2f`.

The asphalt greys are the dark variant as they are. The palette has no light colour: the light variant’s grounds are neutral, and its accent is the yellow darkened, because `#d2b746` is 2.0:1 on white and a bar or an icon needs 3:1.

| Token                    | Dark              | Light                 |
| ------------------------ | ----------------- | --------------------- |
| `background`             | **`#2f2f2f`**     | `#f2f2f2`             |
| `surface`                | `#383838`         | `#ffffff`             |
| `surface-hover`          | `#3e3e3e`         | `#f6f6f6`             |
| `tonal`                  | **`#474747`**     | `#e8e8e8`             |
| `foreground`             | `#f0f0f0`         | **`#2f2f2f`**         |
| `muted-foreground`       | `#b6b6b6`         | **`#565656`**         |
| `accent`                 | **`#d2b746`**     | `#756207`             |
| `accent-foreground`      | **`#2f2f2f`**     | `#ffffff`             |
| `destructive`            | `#ff9494`         | `#c62f2f`             |
| `destructive-foreground` | `#2b0707`         | `#ffffff`             |
| `border`                 | **`#565656`**     | `#cfcfcf`             |
| `ring`                   | **`#d2b746`**     | `#756207`             |
| `overlay`                | `#000000` at 60 % | **`#2f2f2f`** at 40 % |

Lowest contrast — text: 4.58:1 dark, 4.87:1 light; marks: 4.39:1 dark, 4.45:1 light.

## Earth

[Palette 5237](https://www.color-hex.com/color-palette/5237): `#2b5a23` `#506d41` `#828345` `#7a682e` `#544218`.

No two colours of this palette reach 4.5:1 against each other (the best pair is 2.43:1): every ground and every text colour is a tone of the palette’s hues. The accents are the palette’s own: its olive on dark (the owner, 20 November 2026 — a made green stood there first, and the dark variant wore no colour of its palette), its green on light, where its brown is the secondary text. On dark the olive is dimmer than the secondary text: of a paused bar and a running one, the paused is the lighter, and the one without hue.

| Token                    | Dark              | Light                 |
| ------------------------ | ----------------- | --------------------- |
| `background`             | `#120e05`         | `#f1f2e2`             |
| `surface`                | `#1c180e`         | `#fcfcf6`             |
| `surface-hover`          | `#231f15`         | `#f4f5e8`             |
| `tonal`                  | `#322c20`         | `#e0e2cc`             |
| `foreground`             | `#e9ead7`         | `#2b2005`             |
| `muted-foreground`       | `#aca48e`         | **`#544218`**         |
| `accent`                 | **`#828345`**     | **`#2b5a23`**         |
| `accent-foreground`      | `#120e05`         | `#ffffff`             |
| `destructive`            | `#ff8585`         | `#c62f2f`             |
| `destructive-foreground` | `#2b0707`         | `#ffffff`             |
| `border`                 | `#463f30`         | `#cccdb4`             |
| `ring`                   | **`#828345`**     | **`#2b5a23`**         |
| `overlay`                | `#000000` at 60 % | **`#544218`** at 40 % |

Lowest contrast — text: 4.84:1 dark, 4.82:1 light; marks: 3.48:1 dark, 4.14:1 light.

## Bookstore

[Palette 5242](https://www.color-hex.com/color-palette/5242): `#3e1000` `#5a1a05` `#653719` `#ceb035` `#45230c`.

The dark variant is the palette as it is: four browns for the grounds and the gold for the accent. On light the gold is 2.1:1 on white, so the accent is the gold darkened.

| Token                    | Dark              | Light                 |
| ------------------------ | ----------------- | --------------------- |
| `background`             | **`#3e1000`**     | `#f6f0dc`             |
| `surface`                | **`#45230c`**     | `#fefcf4`             |
| `surface-hover`          | `#502d16`         | `#f8f4e4`             |
| `tonal`                  | **`#653719`**     | `#e8e0c1`             |
| `foreground`             | `#f6efd5`         | **`#3e1000`**         |
| `muted-foreground`       | `#d3b7a7`         | **`#653719`**         |
| `accent`                 | **`#ceb035`**     | `#766206`             |
| `accent-foreground`      | **`#3e1000`**     | `#ffffff`             |
| `destructive`            | `#ff9d94`         | `#c62f2f`             |
| `destructive-foreground` | `#2b0707`         | `#ffffff`             |
| `border`                 | `#7d4d30`         | `#d4cba7`             |
| `ring`                   | **`#ceb035`**     | `#766206`             |
| `overlay`                | `#000000` at 60 % | **`#3e1000`** at 40 % |

Lowest contrast — text: 5.25:1 dark, 4.78:1 light; marks: 4.68:1 dark, 4.12:1 light.

## New Car

[Palette 5243](https://www.color-hex.com/color-palette/5243): `#265285` `#c7c7c7` `#a7a7a7` `#878787` `#676767`.

The light variant uses the palette’s blue and two of its silvers; `#a7a7a7` is the secondary text of the dark one. The blue is too dark to be seen on a dark ground (2.6:1 on black): the dark accent is the same hue, lightened.

| Token                    | Dark              | Light             |
| ------------------------ | ----------------- | ----------------- |
| `background`             | `#08101a`         | `#f2f2f2`         |
| `surface`                | `#111a25`         | `#ffffff`         |
| `surface-hover`          | `#18212d`         | `#f6f6f6`         |
| `tonal`                  | `#242f3c`         | `#e8e8e8`         |
| `foreground`             | `#ececec`         | `#1c1c1c`         |
| `muted-foreground`       | **`#a7a7a7`**     | **`#676767`**     |
| `accent`                 | `#71a8ea`         | **`#265285`**     |
| `accent-foreground`      | `#08101a`         | `#ffffff`         |
| `destructive`            | `#ff8585`         | `#c62f2f`         |
| `destructive-foreground` | `#2b0707`         | `#ffffff`         |
| `border`                 | `#35414f`         | **`#c7c7c7`**     |
| `ring`                   | `#71a8ea`         | **`#265285`**     |
| `overlay`                | `#000000` at 60 % | `#1c1c1c` at 40 % |

Lowest contrast — text: 5.64:1 dark, 4.62:1 light; marks: 5.49:1 dark, 4.45:1 light.

## Wood Floor

[Palette 5258](https://www.color-hex.com/color-palette/5258): `#c9731e` `#733214` `#a54b00` `#bf6d1b` `#70300d`.

No two colours of this palette reach 4.5:1 against each other (the best pair is 2.81:1). The accents are the palette’s own oranges; grounds and text are tones of them. Because the accent is an orange, the failure colour is moved toward crimson, as in Brick.

| Token                    | Dark              | Light                 |
| ------------------------ | ----------------- | --------------------- |
| `background`             | `#180904`         | `#fbede3`             |
| `surface`                | `#23120a`         | `#fffbf8`             |
| `surface-hover`          | `#2b1911`         | `#fbf1ea`             |
| `tonal`                  | `#3b261c`         | `#efdcce`             |
| `foreground`             | `#f7e4d6`         | `#391605`             |
| `muted-foreground`       | `#b9a392`         | `#684b3e`             |
| `accent`                 | **`#c9731e`**     | **`#a54b00`**         |
| `accent-foreground`      | `#180904`         | `#ffffff`             |
| `destructive`            | `#ff7a9c`         | `#a3123f`             |
| `destructive-foreground` | `#2b0712`         | `#ffffff`             |
| `border`                 | `#4f362b`         | `#ddc6b4`             |
| `ring`                   | **`#c9731e`**     | **`#a54b00`**         |
| `overlay`                | `#000000` at 60 % | **`#70300d`** at 40 % |

Lowest contrast — text: 5.52:1 dark, 5.82:1 light; marks: 4.02:1 dark, 4.38:1 light.

## Ice

[Palette 5234](https://www.color-hex.com/color-palette/5234): `#aacdee` `#7997d6` `#5b73b4` `#003d6b` `#d5d8f0`.

The light variant is the palette’s lavender, sky blue, mid blue and navy. On dark the navy is the field’s boundary and the lavender the text; the grounds are the navy darkened.

| Token                    | Dark              | Light                 |
| ------------------------ | ----------------- | --------------------- |
| `background`             | `#011021`         | `#ebedfc`             |
| `surface`                | `#031c32`         | `#f9faff`             |
| `surface-hover`          | `#07233c`         | `#eff1fd`             |
| `tonal`                  | `#103251`         | **`#d5d8f0`**         |
| `foreground`             | **`#d5d8f0`**     | **`#003d6b`**         |
| `muted-foreground`       | `#9cadbd`         | `#40586f`             |
| `accent`                 | **`#7997d6`**     | **`#5b73b4`**         |
| `accent-foreground`      | `#011021`         | `#ffffff`             |
| `destructive`            | `#ff8585`         | `#c62f2f`             |
| `destructive-foreground` | `#2b0707`         | `#ffffff`             |
| `border`                 | **`#003d6b`**     | **`#aacdee`**         |
| `ring`                   | **`#7997d6`**     | **`#5b73b4`**         |
| `overlay`                | `#000000` at 60 % | **`#003d6b`** at 40 % |

Lowest contrast — text: 5.71:1 dark, 4.61:1 light; marks: 4.51:1 dark, 3.27:1 light.

## Space

[Palette 5249](https://www.color-hex.com/color-palette/5249): `#000000` `#1c1936` `#2f3069` `#4d3b72` `#5e1118`.

No two colours of this palette reach 4.5:1 against each other (the best pair is 2.18:1): it has no light colour at all. The dark variant’s grounds are the palette as it is — black, indigo, violet — and its text and accent are the violet lightened. The failure colour is a tone of the palette’s own dark red.

| Token                    | Dark                  | Light                 |
| ------------------------ | --------------------- | --------------------- |
| `background`             | **`#000000`**         | `#f1eef9`             |
| `surface`                | **`#1c1936`**         | `#fcfbff`             |
| `surface-hover`          | `#23213e`             | `#f4f2fa`             |
| `tonal`                  | **`#2f3069`**         | `#e1dded`             |
| `foreground`             | `#ece9f6`             | **`#1c1936`**         |
| `muted-foreground`       | `#ada6c0`             | `#59586d`             |
| `accent`                 | `#b39aed`             | **`#4d3b72`**         |
| `accent-foreground`      | **`#000000`**         | `#ffffff`             |
| `destructive`            | `#f78483`             | `#ad2d37`             |
| `destructive-foreground` | **`#000000`**         | `#ffffff`             |
| `border`                 | **`#4d3b72`**         | `#ccc7db`             |
| `ring`                   | `#b39aed`             | **`#4d3b72`**         |
| `overlay`                | **`#000000`** at 60 % | **`#1c1936`** at 40 % |

Lowest contrast — text: 5.15:1 dark, 5.18:1 light; marks: 4.91:1 dark, 4.92:1 light.
