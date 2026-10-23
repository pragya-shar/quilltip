# Articles reading room QA

Local review evidence, 2026-10-20. Keep uncommitted.

## Environment and scope

- Checkout: `/Users/pragyasharma/quilltip`, `design-revamp-quilltip`, baseline `052992d`.
- App: `http://127.0.0.1:3000/articles`; existing Convex configuration.
- Reference: `http://127.0.0.1:4202/discover/index.html`.
- Replaced the Articles presentation with the selected reading-room prototype. Retained real queries, canonical reader routes, URL filters, account-specific bookmarks, and signup returns.
- Real titles, excerpts, authors, topics, and supported sorts replace prototype sample data. Public-domain prototype artwork is a cover fallback. Author selection is available from card bylines and author-filter URLs.
- No backend deployment, publishing, wallet transaction, commit, push, merge, or branch change.
- Existing uncommitted editor work was retained.

## Automated checks

- [x] Full suite before final bookmark guard: 185 files, 1,070 tests passed.
- [x] Final focused suite: 13 tests passed across Articles and BookmarkButton.
- [x] Final TypeScript and ESLint checks passed.
- [x] Production build passed with network access. The initial sandboxed build stalled and was stopped.
- [x] Changed source files pass Prettier; `git diff --check` passed.
- [!] Whole-repository formatting remains blocked by four pre-existing files:
  - `.superpowers/sdd/2026-08-24-highlight-tip-intents/progress.md`
  - `.superpowers/sdd/2026-08-24-highlight-tip-intents/task-1-brief.md`
  - `.superpowers/sdd/2026-08-24-highlight-tip-intents/task-5-brief.md`
  - `docs/development-to-main-qa-checklist.md`

## Visual and interaction checks

- [x] Compared desktop and mobile screenshots with the selected prototype.
- [x] Desktop 1440px: 119px header; first card begins at approximately 446px, matching the reference geometry.
- [x] Desktop 1440px, tablet 768px, mobile 375px: no document horizontal overflow.
- [x] Three initial cards; Load more reveals the fourth real article. `count=6` restores four cards after reload.
- [x] Guest bookmark routes to signup with the specific canonical article and `bookmark=1` return intent.
- [x] Reader opens `/pragya/test-article-4`; browser Back restores `/articles` and the recorded 200px scroll position.
- [x] Clicking a byline applies the author query and reveals the writer selector.
- [x] Empty search and clear-search preserve topic and sort parameters.
- [x] Searching `Demo` returns only Demo Article; Oldest places that article first.
- [x] Fresh-page interaction checks report no browser console errors. Earlier Fast Refresh warnings from changing an effect dependency list did not recur after reload.
- [x] Focused tests cover loading, broken-image fallback, stale search cancellation, pagination filter preservation, account isolation, and bookmark toggling.
- [x] Signup intent is consumed on the individual article, never by a listing card.
- [x] Independent source/screenshot review completed; its mobile spacing finding was fixed.
- [x] Reduced-motion and focus styles inspected in source.
- [ ] Authenticated browser bookmark persistence was not exercised in the isolated inspection session; automated tests cover it.

## Artifacts

Screenshots are saved under:

`/Users/pragyasharma/.codex/visualizations/2026/10/20/01a15961-e2f2-72e2-82ac-b801c7f57d03/articles-revamp/`

- `live-desktop.png`
- `live-mobile.png`
- `live-tablet.png`
- `reference-desktop.png`
- `reference-mobile.png`

Local command logs and the execution ledger are in `/tmp/quilltip-articles-revamp/`.

Visual implementation is ready for the user's review; passing checks do not imply design approval.
