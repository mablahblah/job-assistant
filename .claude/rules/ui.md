# UI & CSS Rules

## Auto-save UX
No Save buttons. Dropdowns and checkboxes fire server actions immediately via `useTransition`. Show "Saving..." in header while pending.

## Tab Nav State
Tab switching uses `useState` + `window.history.replaceState` — NOT `router.push`, which triggers a full server re-render in App Router and breaks client state. Status changes keep jobs in the current tab until page refresh, by design.

## Two-Tier CSS Tokens
`globals.css` uses theme colors (`--black-100`, `--white-90`, etc.) mapped to semantic tokens (`--color-text`, `--color-control-pill-default`, etc.). Always add new colors as a theme value first, then reference via a semantic variable. Never use raw hex in component styles.

## CSS Breakpoints
- Phone: `<768px`
- Tablet: `768–1024px`
- Desktop: `1024–1440px`
- XL: `1440px+`

Root font-size: 14px/16px/18px at these breakpoints. All font-size declarations use `em` (not `rem`/`px`) so they scale proportionally.

## Lottie Animations
`react-useanimations` + custom Lottie JSONs in `lib/animations/`. Exports from `lib/animations/index.ts` are cast to `Animation` type. Always pass a unique `key` prop to `<UseAnimations>` when the animation may change (e.g. per processing stage) — it only loads on mount and won't update without a remount.

## Null Score Display
Null scores display as `"?"` in the UI (treated as 0 in scoring formula so unscored companies sink to bottom).
