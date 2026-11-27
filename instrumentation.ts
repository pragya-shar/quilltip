// Runs once when the server starts (Next.js instrumentation hook).
//
// Turns on the chunk-script change of patches/next@16.4.6.ts for this
// checkout: the patched Next.js runtime acts only when this registration is
// set. A checkout without the patch has no registration, so a runtime that
// stayed patched in node_modules after a branch switch keeps Next.js's output
// there and the pages stay interactive. See docs/performance/next-patch.md.
export const HYDRATE_AFTER_PAINT_REGISTRATION =
  'quilltip.hydrateAfterPaint.loader'

/**
 * The first 12 hex digits of the SHA-256 of public/hydrate-after-paint.js.
 * The loader's URL carries it, so the loader can be cached for good; change
 * it with the loader (scripts/next/next-patch.test.ts checks).
 */
export const HYDRATE_AFTER_PAINT_LOADER_VERSION = 'c1e8e650ff8c'

export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // The off switch: the same state as a checkout without the patch.
  if (process.env.QUILLTIP_HYDRATE_AFTER_PAINT === 'false') return
  ;(globalThis as Record<symbol, unknown>)[
    Symbol.for(HYDRATE_AFTER_PAINT_REGISTRATION)
  ] = HYDRATE_AFTER_PAINT_LOADER_VERSION
}
