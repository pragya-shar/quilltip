# Optional subtitle and reviewed story cleanup

Local review evidence; keep uncommitted.

## Scope and environment

- Existing checkout: `design-revamp-quilltip`.
- Frontend: `http://127.0.0.1:3000/articles`.
- Backend changes applied to the configured Convex **development** deployment.
- No production frontend deployment, commit, push, new publication, or Arweave upload.
- Subtitle is optional in both the current editor and backend publishing validation.
- Cards use an explicit subtitle when present; otherwise they derive up to 240 characters of opening text, shortened at a word boundary.
- Derived previews are not stored as subtitles or inserted into article bodies.
- Existing cover images retained, with prototype artwork as the existing missing/broken-image fallback.

## Reviewed data changes

- [x] Backed up all 43 article records before mutation.
- [x] Dry run confirmed the exact 16 reviewed filler records.
- [x] Hid those 16 by setting `published` to false. Kept their bodies, publication timestamps, Arweave references, and related financial/highlight records.
- [x] Retained 11 readable public stories.
- [x] Verified all 43 records still exist and only the intended visibility/timestamp fields changed during cleanup.
- [x] Rebuilt derived search text and topic links only for the retained 11; their subtitles, bodies, cover images, and Arweave metadata remain unchanged.
- [x] Cleanup is internal-only, defaults to dry run, bounds input size, rejects duplicates, and rejects records whose title or update timestamp changed after review.

Retained: Ancient Architecture; Traveling in Vietnam; The Pyramids of Giza: History & Culture; Timeless London: History, Art, and Culture; The Age of Steam & Speed; Serenity; Galaxies- Stars & Planets; The Big Bloom; Beauty of Sunsets; Photography; Moment to moment.

Hidden: two Untitled records; test art #4; World History; Test article; Sky is the Limit; Test 5; Test article 4; Test article 3; Test Article AV; yyyy; demo 3 nft; Demo 2; Test 2; Demo Article; First Article.

## Verification

- [x] Full test suite: 187 files, 1,082 tests passed.
- [x] Subsequent discovery-index repair: 18 focused tests passed.
- [x] TypeScript, ESLint, production frontend build, changed-file formatting, and diff whitespace checks passed.
- [x] Editor regression test confirms publication confirmation opens with no subtitle.
- [x] Backend tests confirm empty and short subtitles can publish; title, body, and receiving-wallet checks remain.
- [x] Cleanup tests confirm exact selection, preserved permanent references, no scheduled uploads, and rejection of stale review data.
- [x] Live listing reports 11 stories and displays derived opening previews.
- [x] Pagination reaches Photography and Moment to moment on page 2.
- [x] Search for Vietnam finds Traveling in Vietnam.
- [x] Existing first-page cover images load successfully.
- [x] Desktop and mobile screenshots inspected; no horizontal document overflow.
- [x] Fresh browser inspection reported no console errors.
- [ ] No real new article was published to test this, because that would create permanent content. Publication behavior is covered by automated tests.

Command logs, reviewed IDs, before/after snapshots, and screenshots:
`/tmp/quilltip-test-story-cleanup/`.

Review images:
`/Users/pragyasharma/.codex/visualizations/2026/10/20/01a15961-e2f2-72e2-82ac-b801c7f57d03/story-cleanup/`.
