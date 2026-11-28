import { lazy, type ComponentType } from 'react'

/**
 * The balance's content (components/pocket, owned by the Pocket surface),
 * loaded when the sheet or the panel first opens, never in a page's first
 * load. The balance item warms it on hover and focus. A failed load is
 * forgotten, so Try again (in PocketBody) loads afresh. The first-load
 * check refuses components/pocket in every measured route but /pocket.
 */
type Loaded = { default: ComponentType }

let loader: () => Promise<Loaded> = () =>
  import('@/components/pocket/PocketContent').then((module) => ({
    default: module.PocketContent,
  }))

let started: Promise<Loaded> | null = null
let body: ComponentType | null = null

/** Starts loading the balance's content; safe to call many times. */
export function preloadPocket(): Promise<Loaded> {
  if (!started) {
    const attempt = loader()
    started = attempt
    attempt.catch(() => {
      if (started === attempt) forgetPocket()
    })
  }
  return started
}

/** Warms the load from a hover or focus; a failure here stays quiet. */
export function warmPocket() {
  preloadPocket().catch(() => {})
}

/** The lazy content; a new one after a failed load. */
export function lazyPocketContent(): ComponentType {
  body ??= lazy(preloadPocket)
  return body
}

/** Forgets a failed load so the next render tries again. */
export function forgetPocket() {
  started = null
  body = null
}

/** For tests and fixtures: replace how the content loads. */
export function setPocketLoader(next: () => Promise<Loaded>) {
  loader = next
  forgetPocket()
}
