# Geist — EnergyRadar interface typeface

Geist Sans is the primary UI typeface; Geist Mono is used only for technical
identifier fields (IP addresses, hostnames, paths, latency, coordinates).

## Source

| | |
|---|---|
| Family | Geist Sans / Geist Mono |
| Version | **1.7.2** |
| Origin | Official `geist` npm package published by Vercel (`npm pack geist@1.7.2`), files taken from `dist/fonts/geist-sans/` and `dist/fonts/geist-mono/` |
| Upstream | https://vercel.com/font · https://github.com/vercel/geist-font |
| License | SIL Open Font License 1.1 — see [`GEIST-LICENSE.txt`](./GEIST-LICENSE.txt), copied verbatim from the package |
| Copyright | © 2023 Vercel, in collaboration with basement.studio |

The fonts are **self-hosted**. Nothing is fetched from Google Fonts, the Vercel
CDN, jsDelivr, unpkg or any other network source at runtime, and nothing relies
on a font being installed on the machine. `geist` is deliberately *not* a
project dependency — only the five files below are vendored.

## Bundled files

Only the weights the interface actually uses are included. Geist ships the full
range plus italics and variable fonts; those are intentionally omitted.

| File | Family | Weight | Used for |
|---|---|---|---|
| `Geist-Regular.woff2` | Geist | 400 | body copy, default text |
| `Geist-Medium.woff2` | Geist | 500 | labels, navigation, supporting emphasis |
| `Geist-SemiBold.woff2` | Geist | 600 | headings, key values, actions |
| `Geist-Bold.woff2` | Geist | 700 | the few existing strong-emphasis headings |
| `GeistMono-Regular.woff2` | Geist Mono | 400 | technical identifier fields only |

No italic faces are bundled because the interface uses none. Every weight in use
has a real font file, so the browser never synthesises a weight or slant.

## Wiring

`@font-face` rules live in `src/index.css` and reference these files with
relative `url()` paths. Vite fingerprints them into `dist/assets/` and rewrites
the URLs relative to the emitted stylesheet, which is what makes them resolve in
dev, in the production build, and in the packaged desktop app loaded over
`file://`.

## Updating

Re-run `npm pack geist@<version>`, copy the same five files plus `LICENSE.txt`,
and update the version in this file. Do not hand-edit the binaries.
