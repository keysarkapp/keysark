# KeysArk — Logo asset pack

Flat-style identity for KeysArk, a secret & key vault. The mark is an
"ark" hull / shield holding a keyhole.

## Brand colors
| Role            | Hex       |
|-----------------|-----------|
| Indigo (primary)| `#4338CA` |
| Indigo deep     | `#312E81` |
| Indigo tile/bg  | `#211D52` |
| Amber (accent)  | `#F59E0B` |
| Amber deep      | `#D97706` |

Wordmark font: Poppins SemiBold (outlined to paths in the SVGs — no font
needed to display them).

## Files

### svg/  (scalable source — preferred everywhere on web)
- `keysark-logo-full.svg`       — horizontal lockup, for light backgrounds
- `keysark-logo-full-dark.svg`  — lockup for dark backgrounds
- `keysark-logo-full-mono.svg`  — single-color lockup (uses `currentColor`)
- `keysark-icon.svg`            — mark only (color)
- `keysark-icon-white.svg`      — mark only, white hull (dark backgrounds)
- `keysark-icon-mono.svg`       — mark only, single color (`currentColor`)
- `keysark-app-icon.svg`        — full-bleed square app icon
- `keysark-favicon.svg`         — rounded favicon master

### favicon/
- `favicon.ico` (16/32/48), `favicon-16/32/48/64.png`

### app/  (mobile / PWA / store)
- `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`,
  `app-icon-1024.png` (App Store / Play Store; already square, no transparency)

### png/  (raster lockups & icon, transparent)
- `keysark-logo-full.png`, `keysark-logo-full-dark.png`,
  `keysark-logo-full-mono.png`, `keysark-icon-512.png`,
  `keysark-icon-white-512.png`

### social/
- `keysark-og-banner.(svg|png)` — 1200×630 link/social preview

## Web setup
Drop `favicon/`, `app/` and `keysark-favicon.svg` at your site root, then paste
`head-snippet.html` into `<head>`. `site.webmanifest` wires up installable PWA
icons. The mono SVGs inherit the surrounding text color via `currentColor`.

## Clear space & sizing
Keep padding of at least the keyhole's height around the lockup. Minimum
on-screen icon size ~16px; minimum lockup width ~120px.
