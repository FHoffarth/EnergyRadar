# EnergyRadar — Icon System

Abstract mark: a **radar scope** (calm circular frame = monitoring / awareness) holding a
single **energy pulse** waveform with a bright **live-signal node** on the right (current live
reading). Merges energy flow + measurement + live signal + radar awareness with no
lightning-bolt / house / sun cliché. Collapses to a thick ring + one spike at 16px.

## Source of truth (SVG — edit these)

| File | Purpose |
|---|---|
| `icons/energyradar-app-icon.svg` | Master / rounded-square app icon (most structure: subtle navy gradient, faint outer radar arcs). Render source for 128px+ rasters. |
| `icons/energyradar-mark.svg` | Transparent standalone mark, tuned for **dark** backgrounds (sidebar dark mode). |
| `icons/energyradar-mark-light.svg` | Transparent mark, tuned for **light** backgrounds (sidebar light mode). |
| `icons/favicon.svg` | Self-contained favicon tile, medium detail. Render source for 32–64px + scalable favicon. |
| `icons/favicon-simple.svg` | Simplified variant (heavier strokes, single spike). Render source for 16 & 24px. |

## Generated rasters (regenerate from SVG — do not hand-edit)

`favicon.ico` (16/32/48 multi-size), `favicon-16x16.png`, `favicon-24x24.png`,
`favicon-32x32.png`, `favicon-48x48.png`, `favicon-64x64.png`, `favicon-128x128.png`,
`favicon-256x256.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`,
`energyradar-app-icon-512.png` (standalone 512 preview).

## Palette

- Signal cyan (pulse) `#3DDCEB` · bright node `#4FE3F2`
- Scope teal (ring) `#2E7080`
- Tile navy gradient `#132132` → `#0A111C`
- Light-mode deep cyan `#0E9DB8` · light-mode ring navy `#123A46`

## Wiring — paste into `index.html` `<head>`

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/icons/favicon.svg">
<link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32x32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0E1826">
```

(Vite serves anything under `public/` from the site root — move `icons/` and `favicon.ico`
into `public/`, or keep the paths above matching wherever your static root resolves.)

## manifest.webmanifest (add/merge)

```json
{
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }
  ],
  "theme_color": "#0E1826",
  "background_color": "#0A111C"
}
```

## Sidebar / logo component

If a component currently embeds its own SVG, swap it for the mark by theme:

```jsx
import markDark from '@/icons/energyradar-mark.svg';
import markLight from '@/icons/energyradar-mark-light.svg';
const src = theme === 'light' ? markLight : markDark;
<img src={src} width={34} height={34} alt="EnergyRadar" />
```

## Desktop packaging (when the repo adds it)

- **macOS** `.icns` and **Windows** `.ico`: build from `icons/icon-512.png` (already exported).
  Electron-builder reads `build/icon.icns` / `build/icon.ico`; Tauri reads
  `src-tauri/icons/` (icon.png 512, icon.ico, icon.icns).
- **PyInstaller**: `--icon icons/favicon.ico` (Windows) / a generated `.icns` (macOS).

`favicon.ico` here is a real multi-size ICO (16/32/48) suitable for Windows packaging.
`.icns` was **not** generated (needs the macOS `iconutil`/`png2icns` toolchain, absent here) —
generate it from `icon-512.png` on a build machine.

## Regenerating rasters

Rasters are produced by rendering the SVGs to canvas at each target size (no new npm
dependency required). Any SVG→PNG step (`sharp`, `resvg`, `rsvg-convert`, or a headless
canvas) driven from the five source SVGs above reproduces the full set.
