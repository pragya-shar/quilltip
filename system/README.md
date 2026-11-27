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

| Need                                                                     | Use                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A sheet over everything (Add money, Withdraw, Receipt, Pay with, Amount) | `registerSheet(id, Component)` from `@/shell/sheetRegistry`, once, in the surface's own module; then `sheetStack.open(id, props)` from `@/shell/sheetStack`. The component receives `{ open, onClose, props }` and renders `Sheet`. `sheetStack.close(id)` closes it.                                                                    |
| Ask the person to sign in                                                | `openSignIn(intent)` from `@/shell/signIn`. It opens the sheet registered as `SIGN_IN_SHEET` (`'sign-in'`, built by the Account surface) and returns `true`; with none registered it returns `false`, and the caller follows its link to the sign-in page. An intent is shown again after sign-in and never sends money by itself (D15). |
| Open the balance                                                         | `sheetStack.open('pocket')` (a sheet on a phone, a panel on a desktop).                                                                                                                                                                                                                                                                  |
| A pushed screen                                                          | Wrap the page in `PushedScreen`.                                                                                                                                                                                                                                                                                                         |
| The balance figure                                                       | `useBalanceReading()`: `{ auth, available, status }`.                                                                                                                                                                                                                                                                                    |
| A toast                                                                  | `showToast({ title, description, tone, action })` from `@/system/toast`.                                                                                                                                                                                                                                                                 |
| Focus to a title, status or result                                       | `focusDestination(el)` from `@/system/inputModality`.                                                                                                                                                                                                                                                                                    |

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
- CSS: one file per surface, `surfaces/<area>/<area>.css`, inside
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
