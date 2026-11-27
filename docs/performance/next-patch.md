# Next.js patch: chunk scripts after the first paint

`patches/next@16.4.6.ts` changes how Next.js 16.4.6 loads its chunk
scripts on four public routes: `/`, `/login`, `/articles` and the article
page (`/[username]/[slug]`). Every other page, `next dev`, and a build with
subresource integrity keep Next.js's output. The measurements are in
[page-load.md](page-load.md#chunk-scripts-after-the-first-paint-405-428).

## What it does

Next.js writes a page's chunk scripts as `<script async>` tags in the head
and as `preinit` calls. The browser runs them before its first frame, and on
a slow connection they share bandwidth with the stylesheet and fonts.

On the four routes, the patched runtime does this instead:

1. It lists the root chunks in the URL of one small, same-origin loader,
   `public/hydrate-after-paint.js`, and writes that loader in `<head>`
   without `async`. The loader runs before the body is parsed, so before the
   first paint: a press made the moment the page appears is already held
   (below). It is 2.3 KB gzip and waits for the stylesheets before it, which
   the first paint waits for anyway.
2. The loader's URL carries its version, `?v=` followed by the first 12 hex
   digits of the file's SHA-256 (`HYDRATE_AFTER_PAINT_LOADER_VERSION` in
   `instrumentation.ts`; a unit test fails when they differ). It is served
   with `Cache-Control: public, max-age=31536000, immutable`
   (`next.config.ts`, and `vercel.json`, whose no-store rule excludes it), so
   a repeat view does not fetch it before painting.
3. It writes every other chunk script inert, as
   `<script type="text/plain" data-hydrate-after-paint="…">`, with the same
   nonce. Both chunk paths count: `/_next/static/chunks/` and, with
   immutable assets (Vercel), `/_next/static/immutable/chunks/`.
4. Next.js also requires a bootstrap script. That is the same URL with a
   `#b` fragment, async, at the end of the shell. React keeps the two tags
   apart (with the same `src` it merges them and writes only the late async
   tag), while the browser downloads the URL once; when the copy runs, the
   loader has already run and it returns at once.

The loader adds all of them as real async scripts, in the same order, at
the earliest of these events:

- the first contentful paint (the normal case);
- at once, if the page is prerendered, hidden, or restored from the
  back/forward cache;
- after the first frame, in a browser without paint timing or with a blocked
  `PerformanceObserver`;
- at once, on the reader's first press, tap or key;
- after 3 s.

A press on a button, or a form submit, made before React handles that
element is held. It starts the scripts at once and is replayed on the same
element once React has hydrated it, so it is not lost and the browser does
not send the form itself. Links work before hydration, as before.

- Each element is checked on its own, because React hydrates the page in
  parts: the body has React's props before content that loads later.
- An element React does not render never gets those props. Its press goes
  through 5 s after the last chunk script has loaded, or 30 s after the
  press.
- After that point, presses are no longer held.

There is no inline script, and the content security policy is unchanged:
`script-src 'self' 'nonce-…'` already allows the loader and the chunks it
adds.

## Registration, and a checkout without the patch

The patched runtime acts only in a server whose own code turned it on.
`instrumentation.ts` sets a registration on `globalThis` when the server
starts (Node.js runtime only), and the runtime checks it on every page.

- A checkout without the patch has no `instrumentation.ts` registration. If
  the runtimes in `node_modules` stayed patched after a branch switch, that
  checkout's pages keep Next.js's script tags and hydrate as usual.
  (Before this registration, they never hydrated: their HTML pointed at a
  loader file that branch does not have.)
- The patch script writes each patched runtime to a new file and renames it
  over the installed one. With bun's hardlink install backend (the default
  on Linux), `node_modules` and bun's shared download cache share one file;
  the rename gives `node_modules` a new file and leaves the cached one
  unchanged, so a reinstall restores Next.js's own runtime.
- A runtime patched by the earlier version of this patch (which edited the
  file in place) is refused with instructions:
  `rm -rf node_modules/next`, `bun pm cache rm`, `bun install`.

## Switching it off

- Run time: `QUILLTIP_HYDRATE_AFTER_PAINT=false` when the server starts.
  `instrumentation.ts` then does not register, which is exactly the state of
  a checkout without the patch: every page keeps Next.js's output.
  Prerendered pages keep what the build wrote, so set the variable for the
  build too.
- Permanently: see [Removing the patch](#removing-the-patch).

## Checks

| Check                                                       | Where                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| The edits match the runtime exactly once, per route, SRI    | `scripts/next/next-patch.test.ts` (`test:unit`)            |
| The installed Next.js is 16.4.6 and takes the patch         | `scripts/next/next-patch.test.ts`                          |
| The development runtimes are unpatched                      | `scripts/next/next-patch.test.ts`                          |
| Both production runtimes are patched; loader bytes counted  | `perf:first-load` (`scripts/perf/first-load-budget.ts`)    |
| Server HTML: one blocking loader in `<head>`, one late copy | `perf:budget` (`scripts/perf/chunk-loading.ts`)            |
| Both chunk paths, with and without immutable assets         | `scripts/next/next-patch.test.ts`, `chunk-loading.test.ts` |
| The loader version matches the file; Vercel caches it       | `scripts/next/next-patch.test.ts`                          |
| One loader download per view, none on a repeat view         | `e2e/hydrate-after-paint.spec.ts`                          |
| Server HTML: no chunk script before the paint               | `perf:budget`                                              |
| `/support` keeps Next.js's script loading                   | `perf:budget`                                              |
| Without the registration, a patched runtime keeps Next.js   | `scripts/next/next-patch.test.ts`, `perf:stale-runtime`    |
| The patch leaves a hardlinked (cached) runtime unchanged    | `scripts/next/next-patch.test.ts`                          |
| A press the moment the page appears is held (slow loader)   | `e2e/hydrate-after-paint.spec.ts`                          |
| Hydration, menus, forms, navigation in three browsers       | `e2e/hydrate-after-paint.spec.ts`                          |

Run the browser suite against a production build:

```bash
PLAYWRIGHT_ALL_BROWSERS=1 bunx playwright test e2e/hydrate-after-paint.spec.ts
```

## Changing the loader

Set `HYDRATE_AFTER_PAINT_LOADER_VERSION` in `instrumentation.ts` to the first
12 hex digits of the new file's SHA-256 (`shasum -a 256
public/hydrate-after-paint.js`). The loader's URL changes with it, so
browsers that cached the old file fetch the new one; the unit test fails until
the two match. The runtimes need no reinstall.

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
   `instrumentation.ts`, `scripts/next/` and
   `e2e/hydrate-after-paint.spec.ts`, and the `perf:stale-runtime` script
   and its CI step. Remove the `/hydrate-after-paint.js` header rules from
   `next.config.ts` and `vercel.json` (and the exclusion in the no-store
   rule).
2. Remove `bun patches/next@16.4.6.ts &&` from `build` and `build:check` in
   `package.json` and from `buildCommand` in `vercel.json`.
3. Remove the patch checks from `scripts/perf/first-load-budget.ts` and
   `scripts/perf/page-load-budget.ts` (and `scripts/perf/chunk-loading.ts`
   if nothing else uses it).
4. Reinstall Next.js (`rm -rf node_modules/next && bun install`) to restore
   its own runtimes in `node_modules`. Without `instrumentation.ts`, a
   patched runtime already behaves like Next.js's, so this only tidies up.
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
