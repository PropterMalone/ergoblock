# ErgoBlock — Claude Design Handoff

> Briefing doc for a Claude Design pass on ErgoBlock.
> Last updated 2026-05-02. Source of truth: `CLAUDE.md` and `AGENTS.md` in this repo.

## What ErgoBlock is

A Chrome / Firefox extension (Manifest V3) that adds **temporary** blocking and muting to Bluesky. Pick a duration (1h, 6h, 12h, 24h, 3d, 1w, or permanent), and a background service worker auto-expires the block when time's up. Beyond temp blocks, it has Amnesty (review old 3+ month blocks), Blocklist Audit (find prior interactions with blocked users via CAR file parsing), and QT Peek (reveal concealed quoted posts inline).

Currently shipped: v1.15.2, live on Chrome Web Store and Firefox AMO.

## What I want from this design pass

> **the user: fill this in before sending.** Examples of asks:
> - "The Manager is functional but visually crowded — make the table-heavy tabs feel less like a spreadsheet."
> - "The popup is the most-used surface; redesign for a polished first impression."
> - "Pass on the duration picker that injects into Bluesky's menus — make it feel native to Bluesky, not bolted on."
> - "Onboarding / empty states across all tabs."
> - "Dark mode is half-implemented; finish it consistently."
>
> Drop unused suggestions; add specifics.

## UI surfaces

These are every place a user sees ErgoBlock chrome:

| Surface | Entry HTML | Entry TSX | Notes |
|---|---|---|---|
| **Popup** | `popup.html` | `src/popup.tsx` | Quick stats + "Open Manager" button. Browser-action click. |
| **Manager (full-page)** | `src/manager.html` | `src/manager.tsx` | Multi-tab dashboard. The biggest surface. |
| **Options page** | `options.html` | `src/options.tsx` | Settings (which features enabled, durations, columns shown). |
| **Content-script: duration picker** | — | `src/content.tsx` | Injects into Bluesky's `[role="menu"]` when a user clicks Block/Mute. The "1h / 6h / 24h / …" picker. |
| **Content-script: toast** | — | `src/ui/components/content/ContentToast.tsx` | Confirmation toast after action completes. |
| **Content-script: QT Peek** | — | `src/ui/components/content/PeekedQuote.tsx` | Inline-rendered concealed quote, **rendered inside Shadow DOM** so Bluesky's CSS can't leak in. |

### Manager tabs (in `src/ui/components/manager/`)

- `ActionsTable.tsx` — active blocks/mutes (the main view)
- `AmnestyTab.tsx` — old blocks (3+ months) for review
- `BlocklistAuditTab.tsx` — find historical interactions with blocked users
- `ReviewQueueTab.tsx` — pending decisions
- `MassOpsTab.tsx` — bulk operations
- `RepostFiltersTab.tsx` — repost filtering rules
- `CopyUserTab.tsx` — copy a list/blocks from another user
- `SettingsTab.tsx` — settings inside the manager
- `ImportSection.tsx`, `ExportSection.tsx` — data portability
- `StatsBar.tsx`, `StatsSection.tsx`, `StatusIndicators.tsx` — top-of-page status

Shared building blocks live in `src/ui/components/shared/` (Button, Badge, Modal, Toast, Tooltip, etc.).

## Style system today

- **Tokens:** [Open Props](https://open-props.style/) (`@import 'open-props/style'` + `open-props/normalize`).
- **Custom layer on top:** `src/styles/manager.css` (~4500 lines) defines a brand layer (`--brand-primary: var(--blue-6)`, surfaces `--surface-1..3`, text `--text-1..3`, borders, shadows) on top of Open Props tokens.
- **No utility framework.** No Tailwind, no styled-components. Plain CSS files.
- **No CSS-in-JS.** Class names + the design tokens above.
- **Dark mode:** partial (check what's wired up in manager.css before assuming).

A redesign should keep using Open Props as the token base — swapping it out is a much bigger change than restyling on top of it.

## Tech constraints (load-bearing for design decisions)

- **Manifest V3 extension** — Chrome + Firefox. Both stores ship from the same source via `manifest.json` + `manifest.firefox.json`.
- **Preact, not React.** Same JSX shape, but `preact/signals` for state and `preact/hooks` for the standard hooks. Don't write React-only patterns (Server Components, etc. don't apply).
- **esbuild** is the bundler. No PostCSS / Tailwind pipeline unless the build is extended.
- **Strict TypeScript, no `any`.** No `eslint-disable`, no `@ts-ignore`.
- **Extension CSP.** No external CDN at runtime — all fonts, icons, CSS must be bundled into the extension package.
- **Shadow DOM** is used for the `PeekedQuote` content-script rendering so Bluesky's page CSS can't bleed in. Any styling there must be self-contained inside the shadow root.
- **`chrome.storage.sync`** is used for cross-device sync of blocks and settings. Sync storage has per-item and total quotas — a redesign that introduces large per-item state should be flagged.
- **Bluesky-adjacent palette** by convention (the brand layer maps to Open Props blue-6). The extension should feel close to Bluesky without impersonating it.

## What's already in good shape vs. rough

> **the user: edit this — your read of the current visual state matters more than mine.**
>
> Suggested skeleton:
> - **Solid:** [e.g., the Manager is functional and the table dense-info pattern works for power users]
> - **Rough:** [e.g., empty states across tabs are ad-hoc; popup feels utilitarian]
> - **Don't touch:** [e.g., the duration picker injection — UX is locked to Bluesky's menu shape]

## File map for the design pass

```
ergoblock/
├── popup.html, options.html         # entry HTML at root
├── src/
│   ├── manager.html                 # manager entry HTML (note: in src/, not root)
│   ├── popup.tsx, options.tsx, manager.tsx, content.tsx
│   ├── styles/
│   │   └── manager.css              # ~4500 lines, Open Props + brand tokens
│   └── ui/
│       ├── components/
│       │   ├── shared/              # Button, Badge, Modal, Toast, Tooltip, ...
│       │   ├── content/             # DurationPicker, ContentToast, PeekedQuote
│       │   └── manager/             # All Manager tabs
│       ├── hooks/                   # useBlocks, useMutes, useHistory, useOptions
│       ├── signals/                 # Preact signals for manager state
│       └── constants/               # Centralized UI text (tooltips, labels)
└── CLAUDE.md, AGENTS.md             # full project docs
```

For deeper context on the data layer (what data backs each view), see `CLAUDE.md` → "Architecture" and `src/domains/`.

## Out of scope / non-negotiable

- **AT Protocol semantics** (what blocks/mutes actually do at the Bluesky level) — design can change how they're presented but not what they mean.
- **The duration choices** (1h, 6h, 12h, 24h, 3d, 1w, permanent) are user-configurable in Options; don't redesign assuming a fixed set.
- **Open Props as token base** — keep it; restyle on top.
- **Preact** — don't propose a React-only library or pattern.

## Screenshots

> **the user: TODO — capture and attach screenshots of each surface listed above.** Without these, the design pass will be working from imagination. Helpful set:
> - Popup (default state, with stats)
> - Manager → each tab, populated and empty
> - Options page
> - Duration picker injected in Bluesky (before/after click)
> - Content toast
> - QT Peek inline quote
> - Anything currently rough that you want flagged

## How to validate a design proposal

- `npm run validate` (lint + type-check + format + tests) must still pass.
- `npm run build` (Chrome) and `npm run build:firefox` must produce loadable extensions.
- Manual check: load `dist/` as an unpacked extension in both browsers, exercise each surface above.
- Tests in `src/__tests__/` cover the data layer (513 tests). UI changes will rarely break them but a design pass that touches component shape should run them anyway.
