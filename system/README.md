# Building a surface on the Quilltip application shell

The application is a second root layout, `app/(app)/`, beside the pages it
replaces in `app/(legacy)/`. A surface (Read, Money, Discover, Profile, Earn,
Write, ...) is built here from the design system and replaces its legacy
pages in the same pull request.

See the components in every state at `/system` (local: `bun run dev`, then
open `/system`). A sample public reading page is at `/system/reading`.

## The structure (D20)

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
- The bar and the Pocket read the balance through `useBalanceReading()`
  (`@/shell/balance`); never subscribe to the balance again in a surface.
- While no amount is known, the item reads "Balance" (a plain word, not a
  product name), and the sheet's title is "Balance" too.

### Interfaces the shell gives a surface

| Need                                                                                 | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A sheet over everything (Add money, Withdraw, Receipt, Pay with, Amount)             | `registerSheet(id, Component)` from `@/shell/sheetRegistry`, once, in the surface's own module; then `sheetStack.open(id, props)` from `@/shell/sheetStack`. The component receives `{ open, onClose, props }` and renders `Sheet`. `sheetStack.close(id)` closes it.                                                                                                                                                                                                                                                                                                       |
| A sheet another surface may open before your code loads (Add money from the tip bar) | Declare it in `shell/sheets/<package>.ts`: `'add-money': { title, load: () => import('@/components/pocket/sheets/AddMoney') }`; the module's default export is the body, `({ props, close })`. `sheetStack.open('add-money', props)` draws the sheet at once with its title, loads the body behind a placeholder, and shows "This did not load" with Try again on failure. Spread `warmSheet(id)` from `@/shell/sheets/preload` on the opener to load on hover and focus. Keep such bodies under `components/<area>/sheets/` (the first-load check refuses that path).      |
| A money figure                                                                       | `MoneyFigure` with `size`: `xl` (52, Ready to tip), `l` (44, receipt), `m` (36, beside earnings), `pending` (26, On its way beside another figure), `s` (17, rows). Sizes are the `--qt-money-*` tokens; serif sizes raise the cents at half size. Never set a figure's size in pixels.                                                                                                                                                                                                                                                                                     |
| Ask the person to sign in                                                            | `openSignIn(intent)` from `@/shell/signIn`. It opens the sheet registered as `SIGN_IN_SHEET` (`'sign-in'`, built by the Account surface) and returns `true`; with none registered it returns `false`, and the caller follows its link to the sign-in page. An intent is shown again after sign-in and never sends money by itself (D15). The sign-in sheet forgets the remembered wallet when the person is signed out, as `components/auth/ForgetWalletWhenSignedOut` does on the legacy sign-in pages (`forgetAllRememberedWallets` from `lib/wallet/remembered-wallet`). |
| Open the balance                                                                     | `sheetStack.open('pocket')` (a sheet on a phone, a panel on a desktop).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| The balance's content                                                                | `components/pocket/PocketContent.tsx`, owned by the Pocket surface: export `PocketContent`, a client component with no props. The shell renders it in the phone sheet, the desktop panel and `/pocket`. The shell loads it when the sheet or panel opens (warmed on hover and focus of the balance item), never in a page's first load; no public route imports it (the first-load check refuses `components/pocket`).                                                                                                                                                      |
| A pushed screen                                                                      | Wrap the page in `PushedScreen`; put `PushedHeader` (`fallbackHref`, `backLabel`, `actions`) at its top. Back returns through history after an in-app navigation, and is a link to `fallbackHref` when the screen was opened from outside.                                                                                                                                                                                                                                                                                                                                  |
| The balance figure                                                                   | `useBalanceReading()`: `{ auth, available, status }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A row that opens a sheet                                                             | `ActivityRow` with `onPress` (a button over the whole row); with `href` it navigates. Never both.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A toast                                                                              | `showToast({ title, description, tone, action })` from `@/system/toast`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Focus to a title, status or result                                                   | `focusDestination(el)` from `@/system/inputModality`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### A saved setting

`Switch` (`@/system/components/Switch`) with `useSwitchSetting(stored, save)`:
the switch moves at once, shows pending while `save` runs, ignores a second
press meanwhile, and on failure goes back to the value it had and says
"That did not save. Try again." Its row is the control (role `switch`,
Space or Enter), at least 44 px; "On" and "Off" are written beside the
track, so the state never rests on colour.

### The tip control's props

Wire `TipControl` to `useTip(target, meta)` from `hooks/payments`:

| Prop                      | From                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `state`                   | `controller.state` (phases: idle, sending, sent, failed, offline, needs-funds)                                                |
| `amount`, `amounts`       | `controller.amount`, `controller.amounts`                                                                                     |
| `onAmountChange`          | `controller.setAmount`                                                                                                        |
| `onTip`                   | `controller.tip`                                                                                                              |
| `onAddMoney`              | opens the add-money sheet                                                                                                     |
| `recipient`               | the writer's name                                                                                                             |
| `target`, `onClearTarget` | `'passage'` while a line is chosen, and how to clear it                                                                       |
| `unavailable`             | a few words when `controller.unavailable` is set (for example "Tipping paused"); hide the control on the writer's own article |

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
`you`, `signin`, `resources`; rebuild plan 6.1), its routes, its hooks in
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
  plan R4), then imported.
- No new UI library, no Tailwind utility classes, no inline colors.

## Shared lists: add your own file, never edit another's

Each list that every surface adds to is a registry of files, one per
package (`read`, `pocket`, `today`, `shelf`, `write`, `writer`, `search`,
`you`, `signin`, `resources`, `ops`). Each file exists already, empty. A
surface edits only its own file; it never edits `proxy.ts`,
`scripts/fixture-suites.ts`, `ci.yml` or another package's file.

| List                                                                                                     | Your file                               | Shape                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redirects from legacy paths (read by `proxy.ts`, 308)                                                    | `lib/routing/redirects/<package>.ts`    | `{ from, to, keepQuery? }`; `to` is a path, or `(url) => path or null`                                                                                                |
| Deleted paths (`bun run check` fails if one comes back)                                                  | `scripts/rebuild/deleted/<package>.txt` | one path per line                                                                                                                                                     |
| Fixture suites (`bun run test:e2e:fixtures --suite @surfaces`; CI shard `surfaces`, Chromium and WebKit) | `e2e/suites/<package>.ts`               | `{ name, server, port, spec, config?, env }`; ports from 4200                                                                                                         |
| Measured routes (first-load, page-load, font fallbacks)                                                  | `scripts/perf/routes/<package>.ts`      | `{ firstLoad?, pageLoad?, fontFallback? }`; a public route's budget is 150 KB unless its owner justifies more in writing; 170 KB is the ceiling, for signed-in routes |

## Adding a surface

1. Add the route under `app/(app)/(public)/` or `app/(app)/(signed-in)/`.
   Keep `page.tsx` thin: fetch on the server, render a component from
   `components/<area>/`.
2. In the same pull request, delete the legacy route it replaces, with its
   components, CSS, hooks only it used, specs, fixtures, fixture suite entry,
   budget entries and `proxy.ts` font preloads (rebuild plan R2). The same
   URL never exists in both groups. List every deleted path in
   `scripts/rebuild/deleted/<package>.txt`; `bun run check` fails if one comes
   back through a merge.
3. A new top-level segment goes into `APP_ROUTE_SEGMENTS`
   (`lib/routing/publicContentPath.ts`), or the proxy treats it as a
   username.
4. Point the destination in `shell/navigation.ts` at the new route, if it is
   one.
5. Add a fixture suite (in `e2e/suites/<package>.ts`) on the fake payments runtime (`PaymentsRuntime`
   from `lib/payments`) and specs at 390 (touch), 768 and 1440 in Chromium
   and WebKit; reuse `e2e/helpers/systemAudit.ts` for contrast, hit areas
   and overflow. Add a public route to `e2e/reading-no-script.spec.ts` and
   to `scripts/perf/routes/<package>.ts`.

## Public reading works with no script (D19)

- Public routes render their content on the server in the first response.
- No `loading.tsx` and no `Suspense` above reading content in
  `app/(app)/` or `app/(app)/(public)/`. Loading boundaries live only in
  `app/(app)/(signed-in)/` and around enhancements beside the text.
- Links are `next/link` or `TextLink`: real `<a href>` in the HTML.
- The tip control, menus, sheets and the payments runtime attach to text
  that is already there. They never wrap it.

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
4. **Focus goes back.** On close, focus returns to the element that opened
   the sheet, or to the page content (`#content`) if that element is gone.
5. **Focus after a payment starts.** Safari does not focus a button on
   click, so never rely on the pressed button holding focus. When a tip or
   any money act starts, move focus to its status ("Sending $1"); when it
   finishes, to the result ("Sent $1 to Tomás", or the reason it failed). If
   focus is on the body or on a box around the control, treat it as lost
   and move it. The change is read once, by focus: no live region repeats
   it. `TipControl` does all of this; a surface's own money sheets must too.

## Money

- Amounts come from the money layer (`hooks/payments`): a `Money` value
  `{ cents, display }`. Show it with `MoneyFigure`. Never format, round or
  add up money in a surface.
- Before the server answers, pass `value={null} status="loading"`: the
  figure holds its space. When payments are down, `status="unavailable"`.
  A placeholder zero is never drawn.
- Exact amounts read "$4.20". Converted amounts read "≈ $17.28". A real
  amount under a cent reads "<$0.01". The money layer writes these; the
  figure lays them out.
- Dollars only. Token names appear only in the token picker.
- The tip is `TipControl`, wired to `useTip(...)`: pass `state`, `amount`,
  `amounts`, `setAmount` and `tip`. It says "Sent" only after the server
  accepted. No swipe, no long press, no Undo (D3, D6, D7, D11).
- Lime (marker) means money moved and nothing else. Danger means failure
  only, never a negative amount. Money in uses `tone="in"`.
- "Testnet. Practice money only." appears once per screen that shows money
  or where money enters: `TestnetNote`.
- Counts say what they count: "132 tips", never "readers" unless the figure
  is a count of distinct readers (D13, D14).
- A failed tip says "You were not charged." Pending says "On its way".

## States every surface handles

| State                                | How                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Loading, public                      | Nothing: content is in the first response                                                                |
| Loading, signed-in                   | `loading.tsx` in the signed-in segment, or `Skeleton` at final size inside a region with `aria-busy`     |
| Empty                                | `EmptyState`: what is empty, and the one action that fills it                                            |
| Error                                | The route's `error.tsx` falls back to `app/(app)/error.tsx`; inline problems use `Notice tone="failure"` |
| Offline                              | `Notice tone="offline"`; the tip control has its own offline phase                                       |
| Payments unavailable                 | Figures `status="unavailable"`; reading is unaffected                                                    |
| Long, missing and right-to-left text | Test with `system/gallery/samples.ts` `worst` values                                                     |

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
- [ ] First-load JavaScript within the route's budget (public routes at most 150 KB gzip).
- [ ] `bun run check` passes.
