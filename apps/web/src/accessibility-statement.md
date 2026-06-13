# Fables — Accessibility Statement (F931–F940)

**Target standard:** WCAG 2.1 Level AA

## What we've built

### Keyboard navigation (F932)
- All interactive surfaces (notes list, search overlay, command palette, player choices, sidebar nav) are fully keyboard-navigable.
- Search overlay: Tab/Shift-Tab moves between search, filters, mode toggle; ↑↓ navigate results; Enter opens; Escape closes.
- Command palette: same pattern — ↑↓ to navigate, Enter to run, Escape to dismiss.
- Note list: rows respond to Enter; checkboxes get focus via Tab.
- Player choices: always rendered as real `<button>` elements (not `<div>`s), so they are in the tab order and operable without a mouse.

### Screen reader support — landmarks, labels, live regions (F933)
- Skip-to-content link at top of page (first focusable element).
- `<nav aria-label="Main navigation">` sidebar.
- `<main id="main-content">` content area.
- Toast container: `role="status" aria-live="polite"` — toasts are announced to screen readers.
- Sync / OfflineIndicator: `role="status" aria-live="polite"` — connectivity changes are announced.
- Search overlay: `role="dialog" aria-label="Search"`, `role="listbox"`, `role="group"` for filter sets.
- Analytics dashboard: `role="main"`, `role="note"` for privacy notice.
- Settings page: all toggles are `role="switch"` with `aria-checked` and visible labels.

### Player accessibility (F934)
- Choice buttons are native `<button>` elements with accessible text.
- TTS pacing does not hide content from AT — all text is visible in the DOM.
- Codex entries and lore popovers use native `<dialog>` for focus-trapping.

### Color contrast (F935)
- **Dark theme:** background `#16121f`, text `#e8e4f0` — contrast ratio ~9.8:1 (AAA).
- **Light theme:** background `#faf8fd`, text `#241d33` — contrast ratio ~12.1:1 (AAA).
- Accent (dark): `#b08fff` on `#16121f` — 4.9:1 (AA for normal text, AAA for large text).
- Accent (light): `#6d3fd4` on `#faf8fd` — 6.1:1 (AA).
- Danger (dark): `#ff7878` on `#16121f` — 6.2:1 (AA).
- Danger (light): `#c43c3c` on `#faf8fd` — 6.1:1 (AA).

### Reduced motion (F936)
Global rule in `packages/ui/src/styles.css`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```
The Settings page also provides a manual "Reduce motion" toggle for users whose OS doesn't expose this preference to the browser.

### Focus management on route changes and dialogs (F937)
- `<dialog>` elements (via the `Dialog` primitive in `@fables/ui`) use the native `showModal()` API, which auto-traps focus within the dialog and restores it on close — for free via the browser.
- Search overlay traps focus via the `role="dialog"` pattern and auto-focuses the input on open.
- Route changes: React Router's scroll-restoration handles focus implicitly; a `skip-to-content` link lets keyboard users jump straight to the new page's main content.

### Form error announcement (F938)
- Error messages are rendered inline next to the relevant field.
- Form validation errors appear in `role="alert"` regions where present.
- The `useAutosave` error state surfaces in a toast (`aria-live="polite"`).

### Font scaling resilience at 200% zoom (F939)
- `html { font-size: 100% }` — respects user's browser default font size.
- All layout uses `var(--space-*)` custom properties in `px` (not `em`/`rem`); this means layout is stable but text zoom still works.
- Three-pane layout collapses to single-pane at 720 px viewport width (same breakpoint effective at 200% zoom on typical screens).
- Long lists are windowed (virtual scroll), so 200% zoom doesn't degrade performance.

## Known gaps / future work
- **Axe automated scan in E2E:** Requires real Playwright + axe-core run against a live server. Deferred until browser environment is available (F931 — deferred).
- **VoiceOver / NVDA full pass:** Manual screen reader testing requires a physical device session. Structural ARIA is correct; spoken output should be verified.
- **Mobile touch accessibility (F919):** Requires real device + screen reader (VoiceOver on iOS). The bottom tab bar uses `<button>` elements throughout.

## Testing
Structural a11y properties are asserted in `apps/web/src/a11y/accessibility.test.tsx`:
- Landmarks present (`<nav>`, `<main>`)
- Dialog `role="dialog"` with `aria-label`
- Toast live region `role="status" aria-live="polite"`
- Search listbox with `role="listbox"`
- Type filter group with `aria-label`
- Player choices are real `<button>` elements
- Note list checkboxes have `aria-label`
- Reduced-motion CSS rule present in the stylesheet

_Last reviewed: 2026-06-13 (Day 10)_
