# Next.js patch: chunk scripts after the first paint

`patches/next@16.4.6.ts` changes how Next.js 16.4.6 loads its chunk
scripts on four public routes: `/`, `/login`, `/articles` and the article
page (`/[username]/[slug]`). Every other page, `next dev`, and a build with
subresource integrity keep Next.js's output. The measurements are in
[page-load.md](page-load.md#chunk-scripts-after-the-first-paint).

## What it does

Next.js writes a page's chunk scripts as `<script async>` tags in the head
and as `preinit` calls. The browser runs them before its first frame, and on
a slow connection they share bandwidth with the stylesheet and fonts.

On the four routes, the patched runtime does this instead:

1. It lists the root chunks in the URL of one small, same-origin loader,
   `public/hydrate-after-paint.js`.
2. It writes every other chunk script inert, as
   `<script type="text/plain" data-hydrate-after-paint="…">`, with the same
   nonce.

The loader adds all of them as real async scripts, in the same order, at
the earliest of these events:

- the first contentful paint (the normal case);
- at once, if the page is prerendered, hidden, or restored from the
  back/forward cache;
- after the first frame, in a browser without paint timing or with a blocked
  `PerformanceObserver`;
- at once, on the reader's first press, tap or key;
- after 3 s.

A press on a button, or a form submit, made before hydration is held. It
starts the scripts at once and is replayed on the same element once React
handles it, so it is not lost and the browser does not send the form itself.
Links work before hydration, as before.

There is no inline script, and the content security policy is unchanged:
`script-src 'self' 'nonce-…'` already allows the loader and the chunks it
adds.

## Switching it off

- Run time: `QUILLTIP_HYDRATE_AFTER_PAINT=false` restores Next.js's output on
  every page that renders on demand. Prerendered pages keep what the build
  wrote, so set the variable for the build too.
- Permanently: see [Removing the patch](#removing-the-patch).

## Checks

| Check                                                      | Where                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| The edits match the runtime exactly once, per route, SRI   | `scripts/next/next-patch.test.ts` (`test:unit`)         |
| The installed Next.js is 16.4.6 and takes the patch        | `scripts/next/next-patch.test.ts`                       |
| The development runtimes are unpatched                     | `scripts/next/next-patch.test.ts`                       |
| Both production runtimes are patched; loader bytes counted | `perf:first-load` (`scripts/perf/first-load-budget.ts`) |
| Server HTML: one loader, no chunk script before the paint  | `perf:budget` (`scripts/perf/chunk-loading.ts`)         |
| `/support` keeps Next.js's script loading                  | `perf:budget`                                           |
| Hydration, menus, forms, navigation in three browsers      | `e2e/hydrate-after-paint.spec.ts`                       |

Run the browser suite against a production build:

```bash
PLAYWRIGHT_ALL_BROWSERS=1 bunx playwright test e2e/hydrate-after-paint.spec.ts
```

## Upgrading Next.js

The patch refuses any Next.js version other than the one in its file name,
so an upgrade fails `bun run build` and `test:unit` until the patch is
carried forward or removed.

1. Check whether Next.js now has a supported way to load chunk scripts after
   the first paint (see [Upstream](#upstream)). If it does, use it and remove
   the patch.
2. Install the new version and run `bun patches/next@16.4.6.ts`. It reports
   which edit no longer matches.
3. In the new `dist/compiled/next-server/app-page-turbo.runtime.prod.js`,
   find `getRequiredScripts` (search for `rootMainFilesTree`) and React DOM's
   `pushScriptImpl` (search for `e.push(` followed by `("script")`). Update
   the two patterns and the excerpts in `scripts/next/runtime-fixture.txt`.
4. Rename the file to `patches/next@<new version>.ts`, set `NEXT_VERSION`,
   and update the imports and the build commands in `package.json` and
   `vercel.json`.
5. Run `bun run check`, `bun run perf:first-load`, `bun run perf:budget` and
   the browser suite above, and measure again as described in
   [page-load.md](page-load.md).

## Removing the patch

1. Delete `patches/next@16.4.6.ts`, `public/hydrate-after-paint.js`,
   `scripts/next/` and `e2e/hydrate-after-paint.spec.ts`.
2. Remove `bun patches/next@16.4.6.ts &&` from `build` and `build:check` in
   `package.json` and from `buildCommand` in `vercel.json`.
3. Remove the patch checks from `scripts/perf/first-load-budget.ts` and
   `scripts/perf/page-load-budget.ts` (and `scripts/perf/chunk-loading.ts`
   if nothing else uses it).
4. Reinstall Next.js (`rm -rf node_modules/next && bun install`), because the
   patch edits the installed runtimes in place.
5. Measure again: without the patch, simulated mobile LCP is above 2 s on
   every route (see page-load.md).

## Upstream

Checked on 2026-11-27:

- The Next.js documentation has no option for when App Router chunk scripts
  load. `next/script` strategies apply only to scripts the app adds, and
  `experimental.inlineCss` and `experimental.cssChunking` concern
  stylesheets.
- `next/dist/server/app-render/required-scripts.js` always writes the root
  chunks through `ReactDOM.preinit` and a bootstrap script.
- Discussion
  [vercel/next.js#99321](https://github.com/vercel/next.js/discussions/99321)
  ("Reduce baseline client JavaScript for simple App Router routes", open)
  asks for a supported way to reduce or split the baseline client code, and
  its replies say none exists. Issue
  [vercel/next.js#86383](https://github.com/vercel/next.js/issues/86383)
  (open) reports more main-thread work in Next.js 16. Neither has a planned
  option for script timing.
