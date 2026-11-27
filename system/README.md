# Building a surface on the Quilltip application shell

The application is a second root layout, `app/(app)/`, beside the pages it
replaces in `app/(legacy)/`. A surface (Read, Money, Discover, Profile, Earn,
Write, ...) is built here from the design system and replaces its legacy
pages in the same pull request.

See the components in every state at `/system` (local: `bun run dev`, then
open `/system`). A sample public reading page is at `/system/reading`.

## Where things live

| Path                             | What                                                                          | Who changes it                                    |
| -------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| `system/tokens.css`              | Every value: color, type, space, radii, elevation, motion, layers, safe areas | Foundation; the design hand-over replaces values  |
| `system/components/`             | The primitives and their CSS                                                  | Foundation                                        |
| `system/icons.ts`                | The icon vocabulary (one icon per meaning)                                    | Foundation; add a meaning before using a new icon |
| `system/money/`                  | How a figure lays out a money string; tip control phases                      | Foundation                                        |
| `shell/`                         | Frame, navigation config, payments slot, providers                            | Foundation                                        |
| `shell/navigation.ts`            | The navigation destinations, as data                                          | Foundation, from the design session's structure   |
| `surfaces/<area>/`               | A surface's components and its one CSS file                                   | That surface's session                            |
| `app/(app)/(public)/<route>/`    | Public routes: thin `page.tsx` files                                          | That surface's session                            |
| `app/(app)/(signed-in)/<route>/` | Routes that need an account                                                   | That surface's session                            |

A surface session owns `surfaces/<area>/`, its routes, its fixture suite
and its specs. It does not edit `system/` or `shell/`: ask the foundation
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

## Adding a surface

1. Add the route under `app/(app)/(public)/` or `app/(app)/(signed-in)/`.
   Keep `page.tsx` thin: fetch on the server, render a component from
   `surfaces/<area>/`.
2. In the same pull request, delete the legacy route it replaces, with its
   components, CSS, hooks only it used, specs, fixtures, fixture suite entry,
   budget entries and `proxy.ts` font preloads (rebuild plan R2). The same
   URL never exists in both groups.
3. A new top-level segment goes into `APP_ROUTE_SEGMENTS`
   (`lib/routing/publicContentPath.ts`), or the proxy treats it as a
   username.
4. Point the destination in `shell/navigation.ts` at the new route, if it is
   one.
5. Add a fixture suite on the fake payments runtime (`PaymentsRuntime`
   from `lib/payments`) and specs at 390 (touch), 768 and 1440 in Chromium
   and WebKit; reuse `e2e/helpers/systemAudit.ts` for contrast, hit areas
   and overflow. Add a public route to `e2e/reading-no-script.spec.ts` and
   to the first-load, page-load and font fallback route lists.

## Public reading works with no script (D19)

- Public routes render their content on the server in the first response.
- No `loading.tsx` and no `Suspense` above reading content in
  `app/(app)/` or `app/(app)/(public)/`. Loading boundaries live only in
  `app/(app)/(signed-in)/` and around enhancements beside the text.
- Links are `next/link` or `TextLink`: real `<a href>` in the HTML.
- The tip control, menus, sheets and the payments runtime attach to text
  that is already there. They never wrap it.

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
