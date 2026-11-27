import { lazy } from 'react'

/**
 * The balance's content (components/pocket, owned by the Pocket surface),
 * loaded when the sheet or the panel first opens, never in a page's first
 * load. The balance item warms it on hover and focus, so it is usually
 * there by the time the person presses. scripts/perf/first-load.ts refuses
 * components/pocket in the first load of a measured route.
 */
const load = () =>
  import('@/components/pocket/PocketContent').then((module) => ({
    default: module.PocketContent,
  }))

let started: ReturnType<typeof load> | null = null

/** Starts loading the balance's content; safe to call many times. */
export function preloadPocket() {
  started ??= load()
  return started
}

export const LazyPocketContent = lazy(preloadPocket)
