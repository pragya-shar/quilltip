# ENG-246 QA Checklist

## 1. Environment And Setup

- Branch: `eng-246/simplify-writer-canvas`
- Base branch: `development`
- PR: `#199`
- Date: `2026-06-09`
- Verified code head before adding evidence docs: `fa5beddcd68c9d690e2762f16a61cdb86693b432`
- Local URL: `http://localhost:3000` if running local QA
- Preview URL: `https://quilltip-git-eng-246-si-574efe-pragya-sharmas-projects-a6320130.vercel.app`
- Backend target: Vercel preview backend / configured Convex environment for preview; local Convex if running local dev
- Stellar network: Not touched by this PR
- Contract IDs: Not applicable

## 2. Automated Verification

| Status | Area            | Exact action                                                                                                                                                                   | Expected result                            | UI watch | Console/network watch           | Dev server watch    | Note                                                         |
| ------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | -------- | ------------------------------- | ------------------- | ------------------------------------------------------------ |
| [x]    | Focused unit    | `bun run test:once -- components/editor/EditorActionBar.test.tsx`                                                                                                              | Action bar tests pass                      | N/A      | N/A                             | No Vitest failures  | 14 tests passed                                              |
| [x]    | Publish guards  | `bun run test:once -- convex/lib/articleListingReady.test.ts convex/lib/articleTitle.test.ts convex/articles.publishListingReady.test.ts convex/articles.publishTitle.test.ts` | Listing/title guard tests pass             | N/A      | N/A                             | No Vitest failures  | 27 tests passed                                              |
| [x]    | Formatting      | `bun run format:check`                                                                                                                                                         | Prettier reports all files formatted       | N/A      | N/A                             | No formatter errors | Passed after formatting QA doc                               |
| [x]    | Typecheck       | `bun run typecheck`                                                                                                                                                            | TypeScript passes                          | N/A      | N/A                             | No type errors      | Passed                                                       |
| [x]    | Lint            | `bun run lint`                                                                                                                                                                 | ESLint passes                              | N/A      | N/A                             | No lint errors      | Passed                                                       |
| [x]    | Full test suite | `bun run test:once`                                                                                                                                                            | Test suite passes                          | N/A      | Existing warning/log noise only | No failing tests    | 110 files, 613 tests passed                                  |
| [x]    | Build           | `NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud bun run build`                                                                                                            | Production build passes                    | N/A      | Font fetch needs network        | No build errors     | Passed with network access and public Convex URL placeholder |
| [x]    | GitHub checks   | `gh pr checks 199`                                                                                                                                                             | Required, PR Hygiene Required, Vercel pass | N/A      | N/A                             | N/A                 | Passed on `fa5bedd`                                          |

## 3. Primary Changed Workflows

| Status | Area                  | Exact action                                                                                     | Expected result                                                                   | UI watch                                                                                     | Console/network watch                                | Dev server watch       | Note                                                               |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| [-]    | Preview access        | gstack: open preview root unauthenticated                                                        | Preview should either load or show expected deployment protection                 | Vercel auth boundary shown before app                                                        | Root request returned `401`; SSO redirect observed   | N/A                    | Blocked by Vercel deployment protection; no cookies imported       |
| [ ]    | Blank write canvas    | Open `/write` as an authenticated user                                                           | First viewport centers title and body only; no CMS-style excerpt/tags/cover block | Title placeholder `Title`; body placeholder `Share your thoughts...`; no overlapping toolbar | No hydration or runtime errors                       | No React/Next warnings | Manual check required with authenticated preview access            |
| [ ]    | Basic writing         | Type title and body text                                                                         | Autosave status moves through Unsaved/Saving/Saved                                | Text fits, editor stays calm, no layout jump                                                 | Save mutation succeeds                               | No Convex save errors  | Pending                                                            |
| [ ]    | Publish intent        | Click Publish after title/body only                                                              | Publishing details dialog opens with excerpt and tags controls                    | Arweave permanence copy visible; excerpt marked required                                     | No failed requests until final publish               | No errors              | Pending                                                            |
| [ ]    | Missing title guard   | Try publishing with body but no title                                                            | Title error appears only after publish intent and title field receives focus      | Error text does not overlap canvas                                                           | No publish mutation sent                             | No errors              | Pending                                                            |
| [ ]    | Short excerpt guard   | In publish dialog, enter excerpt shorter than 10 chars and click Publish                         | Dialog closes or blocks with clear warning; publish does not succeed              | Warning is understandable and recoverable                                                    | Publish/create mutation rejects or is skipped safely | No unhandled errors    | Pending                                                            |
| [ ]    | Listing-ready publish | Enter title, body, and excerpt with at least 10 chars, then publish only if safe for environment | Publish flow succeeds or reaches expected auth/backend boundary                   | Success panel or expected backend response appears                                           | Mutations succeed; no duplicate publish              | No errors              | Pending; avoid throwaway permanent Arweave publish unless approved |

## 4. Module Or Feature-Specific Workflows

| Status | Area                       | Exact action                                                              | Expected result                                                  | UI watch                                                           | Console/network watch                                       | Dev server watch | Note    |
| ------ | -------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- | ---------------- | ------- |
| [ ]    | Selection bubble toolbar   | Select body text and apply Bold/Italic/Link                               | Bubble appears near selection and command applies                | Toolbar stays in viewport and does not obscure selected text badly | No JS errors                                                | No errors        | Pending |
| [ ]    | Floating insert            | Place cursor in an empty paragraph and use plus menu for H2/H3/quote/code | Insert menu appears and selected block is applied                | Plus control aligns with empty paragraph                           | No JS errors                                                | No errors        | Pending |
| [ ]    | Body image dialog          | Use plus menu -> Insert image                                             | Image dialog opens and can be closed; URL validation still works | Focus returns cleanly; dialog fits viewport                        | No unexpected upload request unless submitted               | No errors        | Pending |
| [ ]    | YouTube dialog             | Use plus menu -> Embed YouTube                                            | Dialog opens, validates URL, and can be closed                   | Dialog fits mobile/desktop                                         | No unexpected failed requests except preview image fallback | No errors        | Pending |
| [ ]    | Cover image menu           | Open More menu on draft without cover                                     | `Add cover image` is available                                   | Menu is reachable and not clipped                                  | No JS errors                                                | No errors        | Pending |
| [ ]    | Cover image existing state | Open a draft with cover image or add one safely                           | Cover preview renders; Change/Remove controls appear over image  | Overlay buttons readable on hover/focus/touch                      | Image loads or shows expected error                         | No errors        | Pending |
| [ ]    | Notes                      | Open Notes on desktop and mobile                                          | Desktop popover / mobile drawer opens, edits autosave            | No overflow or clipped controls                                    | Save mutation includes notes                                | No errors        | Pending |
| [ ]    | More menu                  | Open More menu and inspect undo/redo/delete/word count/read time          | Disabled/enabled states are correct                              | Text does not overflow menu                                        | No JS errors                                                | No errors        | Pending |

## 5. Cross-Feature Regressions

| Status | Area                | Exact action                                                              | Expected result                                                                  | UI watch                                | Console/network watch              | Dev server watch | Note    |
| ------ | ------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------- | ---------------- | ------- |
| [ ]    | Existing draft load | Open `/write?id=<existing-draft-id>` if available                         | Existing content hydrates; stored `Untitled` displays as blank title placeholder | No content flash or overwritten draft   | Article query/save behavior normal | No errors        | Pending |
| [ ]    | Reader page         | Open an existing article page such as `/pragya/test-article-4` if present | Article reader still loads after ENG-245 merge                                   | No editor CSS leakage into article body | No failed page data requests       | No errors        | Pending |
| [ ]    | Draft deletion      | On a saved draft, More menu -> Delete draft, cancel first                 | Dialog opens; cancel preserves draft                                             | Destructive styling clear               | No mutation on cancel              | No errors        | Pending |

## 6. Responsive Checks

| Status | Area             | Exact action                | Expected result                              | UI watch                                   | Console/network watch | Dev server watch | Note    |
| ------ | ---------------- | --------------------------- | -------------------------------------------- | ------------------------------------------ | --------------------- | ---------------- | ------- |
| [ ]    | Mobile `/write`  | Test at `375x812`           | Action bar controls fit; Notes opens drawer  | No button text overflow; title/body usable | No console errors     | No errors        | Pending |
| [ ]    | Tablet `/write`  | Test at `768x1024`          | Canvas remains centered and controls usable  | Bubble/insert controls not offscreen       | No console errors     | No errors        | Pending |
| [ ]    | Desktop `/write` | Test at `1280x720` or wider | Centered writing surface and action bar work | No nested-card clutter or layout shift     | No console errors     | No errors        | Pending |

## 7. Auth, Permissions, And Boundary Checks

| Status | Area                    | Exact action                                 | Expected result                                             | UI watch                   | Console/network watch    | Dev server watch               | Note    |
| ------ | ----------------------- | -------------------------------------------- | ----------------------------------------------------------- | -------------------------- | ------------------------ | ------------------------------ | ------- |
| [ ]    | Signed-out write access | Open `/write` signed out or incognito        | App redirects or blocks according to existing auth behavior | No signed-out editor flash | No unauthorized writes   | No auth errors beyond expected | Pending |
| [ ]    | Draft ownership         | Open an unavailable/foreign draft id if safe | Existing auth/ownership boundary holds                      | Error or redirect is clear | No unauthorized mutation | No errors                      | Pending |

## 8. Persistence, Reload, Caching, And Session Checks

| Status | Area                     | Exact action                                                               | Expected result                                        | UI watch                     | Console/network watch            | Dev server watch | Note    |
| ------ | ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------- | -------------------------------- | ---------------- | ------- |
| [ ]    | Reload after autosave    | Type title/body, wait for Saved, reload                                    | Draft content persists and URL has draft id if created | No duplicate blank draft     | Save/query requests succeed      | No errors        | Pending |
| [ ]    | Unsaved navigation guard | Type content, navigate away before save                                    | Confirmation appears; Stay keeps editor state          | Dialog copy clear            | No unexpected navigation request | No errors        | Pending |
| [ ]    | Local backup             | If network/save failure can be simulated safely, reload after unsaved work | Recovery prompt appears when expected                  | Restore/Discard/Not now work | No storage exceptions            | No errors        | Pending |

## 9. Error, Empty, Loading, And Disabled States

| Status | Area                 | Exact action                                  | Expected result                          | UI watch                                   | Console/network watch       | Dev server watch     | Note    |
| ------ | -------------------- | --------------------------------------------- | ---------------------------------------- | ------------------------------------------ | --------------------------- | -------------------- | ------- |
| [ ]    | Empty body publish   | Click Publish with title only or blank editor | Publish blocked with add-content warning | Warning does not create persistent clutter | No publish mutation sent    | No errors            | Pending |
| [ ]    | Save failure display | Observe or simulate save error if feasible    | Error banner and retry are visible       | Text wraps without overflow                | Failed request is clear     | Error is logged once | Pending |
| [ ]    | Image upload error   | Try invalid image URL/file if safe            | Dialog shows validation error            | Error text associated with field           | No upload for invalid input | No errors            | Pending |

## 10. Wallet, Stellar, Convex, Arweave, Or Contract Checks

| Status | Area                     | Exact action                                            | Expected result                                                             | UI watch             | Console/network watch               | Dev server watch | Note                                                             |
| ------ | ------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------- | ----------------------------------- | ---------------- | ---------------------------------------------------------------- |
| [-]    | Stellar/wallet/contracts | Confirm diff scope                                      | No Stellar, wallet, tipping, NFT, or contract files changed by ENG-246 diff | N/A                  | N/A                                 | N/A              | Not applicable                                                   |
| [ ]    | Convex article saves     | Exercise draft save/publish dialog paths                | Existing Convex article save/publish boundaries hold                        | Save status accurate | Save/publish requests expected only | No Convex errors | Pending                                                          |
| [-]    | Arweave permanence       | Avoid real throwaway publish unless explicitly approved | No permanent test content created unintentionally                           | N/A                  | N/A                                 | N/A              | Publish smoke should stop before permanent write unless approved |

## 11. Cleanup And Uncommitted Artifact Checks

| Status | Area               | Exact action                                             | Expected result                                               | UI watch | Console/network watch | Dev server watch | Note    |
| ------ | ------------------ | -------------------------------------------------------- | ------------------------------------------------------------- | -------- | --------------------- | ---------------- | ------- |
| [ ]    | Local artifacts    | `git status --short`                                     | Only intended tracked docs are present in addition to PR code | N/A      | N/A                   | N/A              | Pending |
| [ ]    | Screenshots/videos | Inspect `.gstack/qa-reports/` and browser outputs        | Local screenshots stay untracked                              | N/A      | N/A                   | N/A              | Pending |
| [ ]    | PR body            | Update PR body with template-compliant Testing and Notes | PR has Summary, Changes, Testing, Notes                       | N/A      | N/A                   | N/A              | Pending |

## Manual Preview Smoke Test List

1. Open the latest PR #199 Vercel preview after the `fa5bedd` deployment is ready. If Vercel asks for auth, sign in with your Vercel/GitHub session.
2. Open `/write` authenticated.
3. Confirm first viewport shows the focused title/body writing surface with placeholders and without persistent excerpt/tags/cover panels.
4. Type a title and body; wait for autosave to reach Saved.
5. Select body text; apply Bold and Link from the bubble toolbar.
6. Put cursor in an empty paragraph; open plus menu; add H2 and quote/code block.
7. Open Notes; type a note; close and confirm no layout overflow.
8. Open More menu; confirm undo/redo state, word count, read time, cover image, and delete entries behave correctly.
9. Click Publish with valid title/body but missing excerpt; confirm Publishing details dialog appears.
10. Try a too-short excerpt; confirm publish is blocked with clear warning and no unhandled error.
11. Add an excerpt of at least 10 characters; stop before final permanent publish unless explicitly approved.
12. Reload the draft after autosave and confirm title/body/notes/excerpt metadata persist.
13. Repeat key layout checks at mobile `375x812`, tablet `768x1024`, and desktop `1280x720`.
14. Open an existing public article page and confirm editor CSS did not regress reader layout.
15. Check browser console/network and dev server output after each step.
