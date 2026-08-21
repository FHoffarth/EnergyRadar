# Self-hosted fonts

Two roles, self-hosted as static WOFF2 (latin, normal, no italics, no condensed).
No runtime Google Fonts / CDN requests; Vite bundles these files into the build.

## Plus Jakarta Sans — UI / text / decision layer (`--font-ui`)
- Weights: 400, 500, 600, 700
- Files: PlusJakartaSans-{Regular,Medium,SemiBold,Bold}.woff2
- License: SIL Open Font License 1.1 — see PLUS-JAKARTA-SANS-LICENSE.txt
- Source: @fontsource/plus-jakarta-sans (latin subset, normal), vendored locally.

## Barlow (normal width — NOT Condensed) — data / measured values (`--font-data`)
- Weights: 500, 600, 700
- Files: Barlow-{Medium,SemiBold,Bold}.woff2
- License: SIL Open Font License 1.1 — see BARLOW-LICENSE.txt
- Source: @fontsource/barlow (latin subset, normal), vendored locally.

## Geist Mono — technical identifier fields only (`--font-mono`)
- Weight: 400 — GeistMono-Regular.woff2 — see GEIST-LICENSE.txt
- Not used in the visible energy cockpit.

Data values (`.tabular-nums` / `.font-data` / `.metric-value`) use Barlow with
tabular + lining figures so numbers align and do not jump on live updates. All
UI text uses Plus Jakarta Sans. font-display: swap.
