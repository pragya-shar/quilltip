# Building a surface on the Quilltip application shell

The application is a second root layout, `app/(app)/`, beside the pages it
replaces in `app/(legacy)/`. A surface (Read, Money, Discover, Profile, Earn,
Write, ...) is built here from the design system and replaces its legacy
pages in the same pull request.

See the components in every state at `/system` (local: `bun run dev`, then
open `/system`). A sample public reading page is at `/system/reading`.

## The structure

Three places and a balance. The bar (phone) and the rail (desktop, from
1024 px) hold **Today** (`/`), **Shelf** (`/shelf`), **Write** (`/write`) and
the **balance**, labelled with the live amount or "Sign in". The balance is
not a place: it opens the **Pocket** over whatever the person is doing, as a
sheet on a phone and a right panel on a desktop (`/pocket` for links and
for no script). Articles (`/{username}/{slug}`), a shared line
(`/p/<code>`), a writer's page (`/{username}`, `/@handle` redirects there),
search, the editor (`/write/<id>`), You (`/you`) and the line pager
(`/lines`) are **pushed screens**. Every money act and the sign-in are
**sheets**.

- A place is a page under `app/(app)/`, listed in `shell/navigation.ts`.
- A pushed screen wraps its page in `PushedScreen` (`@/shell/PushedScreen`):
  the phone bar hides, and the screen slides in only when reached by
  navigation, never on a first load. Its URL, browser back and the edge
  swipe are the browser's own; add no horizontal touch handlers near the
  screen edges. The design asks for an article to expand in place from its
  card; that waits on view transitions (React `ViewTransition`), and no
  dependency is added for it. Until then pushed screens slide.
- A reader never sees the word "Pocket": the sheet's and the page's
  visible title is "Balance", and the bar shows the amount or "Balance".
  "Pocket" is the code's name only.
- The bar and the Pocket read the balance through `useBalanceReading()`
  (`@/shell/balance`); never subscribe to the balance again in a surface.
- The money layer is mounted by the shell: the bar reads its state
  (`paymentsStore`, state only, the one payments module a first load may
  hold), and its payments shell loads after hydration
  (`shell/DeferredPaymentsShell.tsx`), so nothing of it runs with no script.
  The first-load check refuses any other payments code on a shell route.
- While no amount is known, the item reads "Balance" (a plain word, not a
  product name), and the sheet's title is "Balance" too.

### Interfaces the shell gives a surface

| Need                                                                                 | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A sheet over everything (Add money, Withdraw, Receipt, Pay with, Amount)             | `registerSheet(id, Component)` from `@/shell/sheetRegistry`, once, in the surface's own module; then `sheetStack.open(id, props)` from `@/shell/sheetStack`. The component receives `{ open, onClose, props }` and renders `Sheet`. `sheetStack.close(id)` closes it.                                                                                                                                                                                                                                                                                                  |
| A sheet another surface may open before your code loads (Add money from the tip bar) | Declare it in `shell/sheets/<package>.ts`: `'add-money': { title, load: () => import('@/components/pocket/sheets/AddMoney') }`; the module's default export is the body, `({ props, close })`. `sheetStack.open('add-money', props)` draws the sheet at once with its title, loads the body behind a placeholder, and shows "This did not load" with Try again on failure. Spread `warmSheet(id)` from `@/shell/sheets/preload` on the opener to load on hover and focus. Keep such bodies under `components/<area>/sheets/` (the first-load check refuses that path). |
| A money figure                                                                       | `MoneyFigure` with `size`: `xl` (52, Ready to tip), `l` (44, receipt), `m` (36, beside earnings), `pending` (26, On its way beside another figure), `s` (17, rows). Sizes are the `--qt-money-*` tokens; serif sizes raise the cents at half size. Never set a figure's size in pixels.                                                                                                                                                                                                                                                                                |
| A public page whose read is late                                                     | Bound each server read with `withinReadLimit(read)` from `@/shell/public/boundedRead` (1.5 s, `READ_LIMIT_MS`); on timeout or failure render `ReadingUnavailable` (`what`, `retryHref` from `retryHrefFor(path, searchParams)`, `headingLevel`) from `@/system/components/ReadingUnavailable`. It answers 200 with `noindex`, reads with no script, and Try again is a plain link. Never answer "not found" for a late read.                                                                                                                                           |
| Keep a line                                                                          | `KeepButton` (`kept`, `onChange`, `pending`, `showLabel`): a toggle (`aria-pressed`), the bookmark gains a check when kept.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A bar docked at the foot of a pushed screen (the tip bar)                            | Wrap it in `Dock` (`@/shell/Dock`): it tells the shell how far its top edge is from the bottom of the viewport, so toasts sit above it and never cover it.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Clear something from this browser on sign-out                                        | Add `{ name, run: () => import(...).then((m) => m.clear()) }` to `shell/signOut/<package>.ts`; the shell runs every entry when the person goes from signed in to signed out.                                                                                                                                                                                                                                                                                                                                                                                           |
| Warn before sign-out strands something                                               | Add `{ name, check: () => Promise<string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | null> }`to`warnings`in`shell/signOut/<package>.ts`(Write: "2 drafts are only on this device.").`SignOutControl` (`@/shell/signOut/SignOutControl`) asks once, with "Sign out anyway" and "Stay"; a check that throws or answers after 800 ms says nothing and never blocks. The cleanups run after. |
| Sign the person out from a shell page                                                | `signOutHere(useAuthActions().signOut, browserStorage())` from `@/shell/signOut/session`: wallet records go before and after (and on `pagehide`), the cleanups run once the token is gone, and a page change midway is finished by the next shell page. The shell also finishes a sign-out made on a legacy page or another tab (a "signed in here" marker with no token held), and removes every wallet record whenever no token is held.                                                                                                                             |
| Send a signed-out reader to sign in (a guard)                                        | `signInHref(returnTo?)` from `@/shell/signIn`, the one place the address is written: `/login` until the shell's sign-in page ships, then `/signin` (`SIGN_IN_PATH`), with `?returnTo=` a path on this site, and no return path while a sign-out runs. Never write `/login`, `/signin` or `?next=` yourself.                                                                                                                                                                                                                                                            |
| Know before paint whether a session token is held                                    | `hasAuthToken(storage)` and `AUTH_TOKEN_PREFIX` from `@/shell/prePaint`; the root layout's pre-paint script sets `data-session="held"` on `<html>` (and the stored theme).                                                                                                                                                                                                                                                                                                                                                                                             |
| A second fact on an activity row                                                     | `ActivityRow` `detail` ("from a $2 tip", "A reader"), with `detailIcon="pending"` for the clock; apart from `time`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Ask the person to sign in                                                            | `openSignIn(intent)` from `@/shell/signIn`. It opens the sheet registered as `SIGN_IN_SHEET` (`'sign-in'`, built by the Account surface) and returns `true`; with none registered it returns `false`, and the caller follows its link to the sign-in page. An intent is shown again after sign-in and never sends money by itself. The sign-in sheet forgets the remembered wallet when the person is signed out, as `components/auth/ForgetWalletWhenSignedOut` does on the legacy sign-in pages (`forgetAllRememberedWallets` from `lib/wallet/remembered-wallet`).  |
| Link to the sign-in page                                                             | `signInHref(returnTo?)` from `@/shell/signIn`, the one place the address is written: `/login` until the shell's sign-in page ships, then `/signin`, with `?returnTo=` a path on this site. Never write `/login`, `/signin` or `?next=` yourself.                                                                                                                                                                                                                                                                                                                       |
| Open the balance                                                                     | `sheetStack.open('pocket')` (a sheet on a phone, a panel on a desktop).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| The balance's content                                                                | `components/pocket/PocketContent.tsx`, owned by the Pocket surface: export `PocketContent`, a client component with no props. The shell renders it in the phone sheet, the desktop panel and `/pocket`. The shell loads it when the sheet or panel opens (warmed on hover and focus of the balance item), never in a page's first load; no public route imports it (the first-load check refuses `components/pocket`).                                                                                                                                                 |
| A pushed screen                                                                      | Wrap the page in `PushedScreen`; put `PushedHeader` (`fallbackHref`, `backLabel`, `actions`; `variant="close"` for a task screen such as the editor, with `onBack` to store work first, bounded at 800 ms) at its top. Back returns through history only when the entry behind is a page of the application, and is a link to `fallbackHref` otherwise (opened from outside, or after the browser's Back reached the first page): it never leaves the site.                                                                                                            |
| The balance figure                                                                   | `useBalanceReading()`: `{ auth, available, status }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A row that opens a sheet                                                             | `ActivityRow` with `onPress` (a button over the whole row); with `href` it navigates. Never both. `label` names that link or button when `name` alone does not say enough ("A reader, plus 98 cents, open receipt"); start it with the visible name.                                                                                                                                                                                                                                                                                                                   |
| A control shown but not usable now                                                   | `Button` or `IconButton` with `unavailable` (`true`, or the reason: "Not available yet"): it stays focusable, says `aria-disabled`, and a press does nothing; `IconButton` adds the reason to its name, `Button` gives it as the description. A caller's own `aria-disabled` counts too. Use `disabled` only for a control nobody should reach.                                                                                                                                                                                                                        |
| A toast                                                                              | `showToast({ title, description, tone, action })` from `@/system/toast`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Focus to a title, status or result                                                   | `focusDestination(el)` from `@/system/inputModality`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### A saved setting

`Switch` (`@/system/components/Switch`) with `useSwitchSetting(stored, save)`:
the switch moves at once, shows pending while `save` runs, ignores a second
press meanwhile, and on failure goes back to the value it had and says
"That did not save. Try again." Its row is the control (role `switch`,
Space or Enter), at least 44 px; "On" and "Off" are written beside the
track, so the state never rests on colour.

### The tip control's props

Wire `TipControl` to `useTip(target, meta)` from `hooks/payments`:

| Prop                      | From                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                   | `controller.state`: `idle`, `holding` (the hold before sending, `{ phase: 'holding', amount }`), `sending`, `sent`, `failed`, `offline`, `needs-funds`, and `other` (`{ phase: 'other', words, amount, busy }`) for one more phase the money layer adds                                                                                                                                                                                                                                                                                                                                   |
| `amount`, `amounts`       | `controller.amount`, `controller.amounts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `onAmountChange`          | `controller.setAmount`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `onTip`                   | `controller.tip`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `onAddMoney`              | opens the add-money sheet (`sheetStack.open('add-money', props)`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `onNotNow`                | after a failure: back to idle ("Not now")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `recipient`               | the writer's full name; the button says "Tip {first name} $1"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `target`, `onClearTarget` | `'passage'` while a line is chosen ("Tip this line $1"), and how to clear it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `hold`                    | while the controller holds the tip (the hold before sending): `{ projected?: { before, after }, onCancel, onAddOne, addOneBlocked?: reason, restartKey }`, with `before` and `after` money values ("≈ $18.40 → ≈ $17.40" drawn, "about 18 dollars 40, then about 17 dollars 40" heard). The control draws Cancel, the status with a countdown over `--qt-dur-hold` (3000 ms, not shortened by reduced motion), and "+$1" (disabled with its reason); Escape cancels while focus is in the control. It keeps no timer: the controller owns the hold, its timing, the caps and the sending. |
| `unavailable`             | a few words when `controller.unavailable` is set (for example "Tipping paused"); hide the control on the writer's own article and page                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `balance`                 | the reader's spendable figure (`controller.balance`): the tray shows "≈ $18.40 ready to tip"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `onOpenBalance`           | `() => sheetStack.open('pocket')`: the tray's caption becomes a control, the way to the balance on a pushed screen at phone width ("about 7 dollars ready to tip. Open balance")                                                                                                                                                                                                                                                                                                                                                                                                          |
| `amountControl`           | `labelled` where the design shows the word "Amount" on the amount control; `icon` (default) names it "Change amount"                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Amounts on the button are the money layer's short text when it gives one (`short`: "$1"), else `display`. The words follow the design's tip moment: "Tip Tomás $1", "Tip this line $1", "Sending $1",
"Sent $1", "Try again: tip $1" with "Not now" and the reason "That tip did
not go through. You were not charged.", "Offline. You can tip when you
reconnect.", "Add money to tip $1". After a refusal, the button states the
amount chosen since, as the amount control does. Focus goes to the status when a tip is
held or sending, stays on "Sent", and moves to the reason on a failure; the
one live announcement is "Cancelled. Nothing was sent." A held key or a
double press asks for one tip: repeated keys are refused on every button of
the control, and a press waits up to a second for the phase to move. "Other"
takes a decimal point or a decimal comma ("2.50", "2,50"). Until the
controller has the hold, the tip sends at once and the hold shows only in
the gallery and the tests.

### Passage marks and reading

`PassageMark` takes a `state`, each with a cue that does not
rest on colour, or two that go together (`COMBINABLE`): a chosen line keeps
other readers' fill (`['others-top', 'chosen']`), and a line can be kept and
yours at once (`['mine', 'kept']`):

| `state`                     | Look                                                         | Cue beyond colour                                              |
| --------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| `others-top` (with `count`) | soft fill                                                    | the tip count after the line, in marker-ink                    |
| `others`                    | faint fill                                                   | none; the tip bar's row says "N tips on this line" when chosen |
| `mine`                      | full marker                                                  | a check raised after the line                                  |
| `kept`                      | marker-ink underline                                         | the underline                                                  |
| `chosen`                    | ink underline                                                | the underline and an ink tick in the margin                    |
| `holding` (with `holdKey`)  | a band filling the bottom of each line in turn over the hold | the band's growth and the "Sending $1" status                  |
| `place`                     | a marker-ink tick in the margin that fades                   | the tick                                                       |
| `share-line`                | dashed marker-ink underline                                  | the dash                                                       |

Fills and underlines render with no script; the margin ticks and the band
need it. No state moves the text: marks have no padding or margin (the fill
bleeds by a shadow) and the check takes no width, so a line going from
chosen to holding to yours keeps every line break. `Prose leadIn` sets the first line in
small caps; figures run edge to edge on a phone (`figure` with
`figcaption`); a footnote reference is `a.qt-fn-ref` linking to the full
path with `#fn-N`, and the notes a `.qt-footnotes` list.

## Where things live

| Path                             | What                                                                          | Who changes it                                    |
| -------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| `system/tokens.css`              | Every value: color, type, space, radii, elevation, motion, layers, safe areas | Foundation; the design hand-over replaces values  |
| `system/components/`             | The primitives and their CSS                                                  | Foundation                                        |
| `system/icons.ts`                | The icon vocabulary (one icon per meaning)                                    | Foundation; add a meaning before using a new icon |
| `system/money/`                  | How a figure lays out a money string; tip control phases                      | Foundation                                        |
| `shell/`                         | Frame, navigation config, payments slot, providers                            | Foundation                                        |
| `shell/navigation.ts`            | The navigation destinations, as data                                          | Foundation, from the design session's structure   |
| `components/<area>/`             | A surface's components and its one CSS file                                   | That surface's session                            |
| `app/(app)/(public)/<route>/`    | Public routes: thin `page.tsx` files                                          | That surface's session                            |
| `app/(app)/(signed-in)/<route>/` | Routes that need an account                                                   | That surface's session                            |

A surface session owns `components/<area>/` (a new directory named for its
package: `read`, `pocket`, `today`, `shelf`, `write`, `writer`, `search`,
`you`, `signin`, `resources`), its routes, its hooks in
`hooks/<area>/`, its fixture suite and its specs. It does not edit `system/` or `shell/`: ask the foundation
for a missing token, component or state.

## What a surface may import

- Yes: `@/system/*`, `@/shell/*`, `hooks/payments`, `lib/payments` (types
  and the money layer), Convex queries through `hooks/` and `convex/react`,
  `lib/` logic (auth, routing, seo, articles, tiptap), `next/*`.
- No: `components/layout`, `components/dashboard`, `components/account`,
  `components/tipping`, `components/tab`, `components/articles`,
  `components/landing`, `components/ui`, `app/globals.css`,
  `app/shared-ui.css`, or anything under `app/(legacy)/`. Logic inside an old
  component is extracted into `hooks/<area>/` or `lib/<area>/` first (rebuild
  first), then imported.
- No new UI library, no Tailwind utility classes, no inline colors.

## Shared lists: add your own file, never edit another's

Each list that every surface adds to is a registry of files, one per
package (`read`, `pocket`, `today`, `shelf`, `write`, `writer`, `search`,
`you`, `signin`, `resources`, `ops`). Each file exists already, empty. A
surface edits only its own file; it never edits `proxy.ts`,
`scripts/fixture-suites.ts`, `ci.yml` or another package's file.

| List                                                                                                     | Your file                               | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redirects from legacy paths (read by `proxy.ts`, 308)                                                    | `lib/routing/redirects/<package>.ts`    | `{ from, to, keepQuery? }`; `to` is a path, or `(url) => path or null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| First path segments that are never a handle                                                              | `lib/routing/segments/<package>.ts`     | the top-level segment of each route you add                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Unit tests                                                                                               | `scripts/<package>/*.test.ts`           | picked up by `bun run test:unit` unless the directory has its own `*.config.mts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Deleted paths (`bun run check` fails if one comes back)                                                  | `scripts/rebuild/deleted/<package>.txt` | one path per line; every file gone from `app/(legacy)` (against `scripts/rebuild/legacy-files.txt`, the files at the split) must be listed, and no legacy file may be added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Fixture suites (`bun run test:e2e:fixtures --suite @surfaces`; CI shard `surfaces`, Chromium and WebKit) | `e2e/suites/<package>.ts`               | `{ name, server, port, spec, config?, env }`; ports from 4200                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Measured routes (first-load, page-load, font fallbacks)                                                  | `scripts/perf/routes/<package>.ts`      | `{ firstLoad?, pageLoad?, fontFallback?, noScript?, unmeasured? }`. A legacy entry (`scripts/perf/routes/legacy.ts`) drops out when its page is in your `deleted/<package>.txt` or your entry names the same route or path; never edit `legacy.ts` or the scripts. Every page open signed out (under `app/(app)/` but not `(signed-in)/`) needs a first-load entry and a `noScript` entry (a production-build check of yours covers its no-script response), or an `unmeasured` entry with the reason. A route's first-load budget is its first CI measurement plus 2 KB, at most 195 KB for a public route and 170 KB for a signed-in one (`FIRST_LOAD_CEILING_KB`; the public target is 150 KB); `pageLoad[].budget` is `{ htmlKb, cssKb, fontKb, cls?, lcpMobileMs? }`: `cls` gates both profiles, `lcpMobileMs` gates the phone profile (Moto G Power, throttled); public routes use `cls: 0.05, lcpMobileMs: 2000` |
| Checks that need a production build (redirects, CSP, a slow backend, the no-script response)             | `scripts/app-checks/<package>.ts`       | `{ name, command }`; run after `next build` against `next start` on the fixture backend, with `PLAYWRIGHT_BASE_URL` set (CI job "Production build checks"); run Playwright in Chromium and WebKit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Sheets other surfaces open before your code loads                                                        | `shell/sheets/<package>.ts`             | `{ title, description?, load }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| What sign-out clears                                                                                     | `shell/signOut/<package>.ts`            | `{ name, run }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Adding a surface

1. Add the route under `app/(app)/(public)/` or `app/(app)/(signed-in)/`.
   Keep `page.tsx` thin: fetch on the server, render a component from
   `components/<area>/`.
2. In the same pull request, delete the legacy route it replaces, with its
   components, CSS, hooks only it used, specs, fixtures, fixture suite entry
   and `proxy.ts` font preloads; its budget entries leave by themselves once
   its page is in your `deleted/<package>.txt`. The same
   URL never exists in both groups. List every deleted path in
   `scripts/rebuild/deleted/<package>.txt`; `bun run check` fails if one comes
   back through a merge.
3. Add the top-level segment of each new route to
   `lib/routing/segments/<package>.ts`, or the proxy reads it as a writer's
   handle (`bun run check` fails until you do).
4. Point the destination in `shell/navigation.ts` at the new route, if it is
   one.
5. Add a fixture suite (in `e2e/suites/<package>.ts`) on the fake payments runtime (`PaymentsRuntime`
   from `lib/payments`) and specs at 390 (touch), 768 and 1440 in Chromium
   and WebKit; reuse `e2e/helpers/systemAudit.ts` for contrast, hit areas
   and overflow. Add a public route to `e2e/reading-no-script.spec.ts` and
   to `scripts/perf/routes/<package>.ts`.

## Public reading works with no script

- Public routes render their content on the server in the first response.
- No `loading.tsx` and no `Suspense` above reading content in
  `app/(app)/` or `app/(app)/(public)/`. Loading boundaries live only in
  `app/(app)/(signed-in)/` and around enhancements beside the text.
- Links are `next/link` or `TextLink`: real `<a href>` in the HTML.
- The tip control, menus, sheets and the payments runtime attach to text
  that is already there. They never wrap it.

## Known bounds

- A list of articles (Today's "More to read", a writer's page) can show a
  hidden article's card for up to 60 seconds after it is hidden: the list
  cache keeps it that long, until the cache is fixed on the backend.

## Signed-in routes need no server guard

`app/(app)/(signed-in)/` has no server-side check, and needs none: no route
in the shell reads an auth cookie or queries account data on the server.
The rule is on the client: nothing with a name, a figure or a row renders
before auth answers (a neutral skeleton while it loads, the sign-in prompt
when signed out), and with no script a signed-in page asks the person to
sign in (`/pocket`). A route that ever reads account data on the server
needs a server guard first.

## Landmarks on a public page

What a test or an assistive technology finds, so selectors are written
once:

- **Every page:** one `main` (`#content`, the skip link's target). There is
  no `banner` landmark: the shell has no site header, by design (the bar or
  the rail carries the places).
- **Phone, a place (Today, Shelf, Write):** a `navigation` named "Main" (the
  bar) with links Today, Shelf, Write and the balance item.
- **Phone, a pushed screen (an article, a writer's page, search):** no
  navigation landmark (the bar is hidden). The way home is the back link at
  the top of `main`, named "Back to …" (`PushedHeader`, a plain link to
  `fallbackHref` when the screen was opened from outside).
- **Desktop (1024 px and up), every page:** a `navigation` named "Main" (the
  rail) with the wordmark link "Quilltip" to `/`, Today, Shelf, Write and
  the balance item.

So a test that needs "a link home" uses
`getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' })`
on places and on desktop, and `getByRole('link', { name: /^Back to/ })` on a
pushed screen on a phone; never `role=banner`.

## Sheets, dialogs and focus

`Sheet` and `Dialog` follow these rules; a surface that moves focus itself
follows them too (use `focusDestination` from `@/system/inputModality`).

1. **Where a sheet or dialog opens.** Focus lands on its title, or on the
   first meaningful control when that control has `data-autofocus`; never on
   Close. Close is visible, reachable and last in the Tab order.
2. **Rings only for the keyboard.** A focus ring shows only after keyboard
   use. Opening by touch or pointer draws no ring, because Chrome carries
   `:focus-visible` into the next script focus.
3. **Tab wraps, in every engine.** Tab and Shift+Tab move through every
   control and wrap, and so do Option+Tab and Shift+Option+Tab in Safari
   (by default Safari's plain Tab reaches only text fields).
4. **Focus goes back.** On Escape or Close, focus returns to the element
   that opened the sheet (opened by a key, the focused control; opened by a
   tap or a click, the control pressed, since Safari focuses none), or to the page content (`#content`, else `main`)
   if that element is gone, never the page body. If the page has moved
   focus by the time a sheet goes (it unmounted mid-close), focus stays
   where the page put it. Lazily loaded sheets keep focus on the title after
   their body arrives. `e2e/helpers/modalFocus.ts` checks a modal by its role
   and its own `aria-labelledby`.
5. **Focus after a payment starts.** Safari does not focus a button on
   click, so never rely on the pressed button holding focus. When a tip or
   any money act starts, move focus to its status ("Sending $1"); when it
   finishes, to the result ("Sent $1 to Tomás", or the reason it failed),
   always with `preventScroll`. When the status leaves, focus goes back to
   the control only if the control still holds it: track that (you moved
   focus there, and the person has not pressed elsewhere or tabbed away).
   "Focus is on the body" is no test: in Safari a press on plain text leaves
   it there too. The change is read once, by focus: no live region repeats
   it. `TipControl` does all of this; a surface's own money sheets must too.
6. **A press while a sheet closes reaches nothing.** For 400 ms after a
   press closes a sheet or dialog, the shell swallows pointer presses
   (`@/system/pressGuard`); key presses always pass. Drop a guard of your
   own; `pressesHeld()` says whether one is in force.
7. **A new path closes the sheets.** When the path changes, every open
   sheet closes: a link followed from a sheet never leaves it over the new
   page. Open a sheet after navigating, not before.
8. **Toasts survive a modal.** The toast region is one element that moves
   into the top modal and back; a toast keeps its time and is announced
   once. Every tap passes through a toast to what is under it, except on
   its one action; focus on the action pauses it (no hover needed).

9. **A field error is read once.** On submit, move focus to the first
   invalid `TextField`; its error comes with it (`aria-describedby`,
   "invalid"). When focus stays elsewhere (a server answer while the reader
   is on the button), pass `errorAnnouncement="live"`: a polite live region,
   present from the start, says it. Never both.

10. **A list of choices opens on the first usable one.** A menu, a
    radio group or a list in a sheet puts focus on the first choice the
    reader can use, never a disabled or unavailable one (`Menu` items take
    `disabled`; arrow keys skip them too).

## Money

- Amounts come from the money layer (`hooks/payments`): a `Money` value
  `{ cents, display }`. Show it with `MoneyFigure`. Never format, round or
  add up money in a surface.
- Before the server answers, pass `value={null} status="loading"`: the
  figure holds its space. When payments are down, `status="unavailable"`.
  A placeholder zero is never drawn.
- A figure converted at today's price (the reader's balance, held in XLM)
  comes with `converted: true` on the value from the money layer: the
  figure writes "≈ $18.40" (two decimals) and a screen reader hears
  "about". A direction comes in the money layer's text ("−$1.00",
  "+$1.95", "≈ −$1.00") and is heard as "minus" or "plus". A label that says an
  amount in words uses `spokenValue(value)`: the money layer's `spoken`
  when it gives one, else the same words the layer uses ("9.75 cents",
  "1 dollar 95", "about 18 dollars 40"). "≈" and "→"
  are drawn in the platform face, which has both. The bar's balance item shows it in a fixed 86 px slot,
  with or without "≈". Everything fixed at tip time is exact and bare.
- Amounts are exact: two decimals, and up to six when the amount has
  fractions of a cent ("$1.95", "$0.0975", "$2.925"). An amount below the
  sixth decimal reads "$0.00" with the exact token amount one tap away.
  "<$0.01" is never used. "≈" appears only on a figure converted at today's
  price (held in a token, a wallet's holdings, the token picker), never on
  a tip, a row or a receipt. The money layer writes these; the figure lays
  them out and refuses anything else (it then says "Unavailable").
- Dollars only. Token names appear only in the token picker.
- The tip is `TipControl`, wired to `useTip(...)`: pass `state`, `amount`,
  `amounts`, `setAmount` and `tip`. It says "Sent" only after the server
  accepted. No swipe, no long press, no Undo.
- Full lime (marker) means money that is yours (your tip, accepted; Sent);
  other readers' tips are soft or faint; a chosen line is an ink underline,
  never a fill. Danger means failure
  only, never a negative amount. Money in uses `tone="in"`.
- "Testnet. Practice money only." appears once per screen that shows money
  or where money enters: `TestnetNote`.
- Counts say what they count: "132 tips", never "readers" unless the figure
  is a count of distinct readers.
- A failed tip says "You were not charged." Pending says "On its way".

## States every surface handles

| State                                | How                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Loading, public                      | Nothing: content is in the first response                                                                               |
| Loading, signed-in                   | `loading.tsx` in the signed-in segment, or `Skeleton` at final size inside a region with `aria-busy`                    |
| Empty                                | `EmptyState`: what is empty, and the one action that fills it; `headingLevel` (1 to 3) when it is a section of the page |
| Error                                | The route's `error.tsx` falls back to `app/(app)/error.tsx`; inline problems use `Notice tone="failure"`                |
| Offline                              | `Notice tone="offline"`; the tip control has its own offline phase                                                      |
| Payments unavailable                 | Figures `status="unavailable"`; reading is unaffected                                                                   |
| Long, missing and right-to-left text | Test with `system/gallery/samples.ts` `worst` values                                                                    |

## Naming

- Components: PascalCase, one per file, named for what they are
  (`BalanceFigure`, not `NewBalance` or `BalanceV3`).
- CSS: one file per surface, `components/<area>/<area>.css`, inside
  `@layer surfaces`. Classes `qt-<area>__<part>`; state in `data-*`
  attributes. Only tokens: no hex, no raw `oklch()`, no `z-index` outside the
  layer tokens, no `100vh` (use `100dvh`).
- Copy: second person, short, no jargon (no "tab", "voucher", "settle",
  "wallet address", "XLM", "USDC" outside the token picker). The product is
  "Quilltip"; published pieces are "articles"; their link says "Read more".

## Checklist before a surface pull request

- [ ] The legacy route and everything only it used are deleted in this pull request.
- [ ] Public routes: the article or list is in the server HTML; the no-script spec covers the route.
- [ ] Every state in the table above is reachable in the fixture suite.
- [ ] Every control is at least 44 by 44 px; contrast passes in light and dark (`systemAudit`).
- [ ] Focus order follows the page; focus is visible; sheets return focus.
- [ ] Reduced motion: nothing travels; meaning is carried in words.
- [ ] No horizontal scroll at 360, 375 and 390.
- [ ] Money: only `MoneyFigure` and `TipControl` show amounts; no surface math; testnet said once.
- [ ] First-load JavaScript within the route's budget: the first CI measurement plus 2 KB (public routes at most 195 KB gzip for now, target 150).
- [ ] `bun run check` passes.
