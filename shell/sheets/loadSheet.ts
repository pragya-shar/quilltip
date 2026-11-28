import { lazy, type ComponentType } from 'react'
import { declaredSheet, type SheetBodyProps } from '.'

type Body = ComponentType<SheetBodyProps<unknown>>

const started = new Map<string, Promise<{ default: Body }>>()
const lazies = new Map<string, ComponentType<SheetBodyProps<unknown>>>()
/** Bodies whose code has arrived: drawn at once, never through a lazy
 * component (whose first render suspends even when the code is here, and
 * React then holds the revealed content back for about 300 ms). */
const loaded = new Map<string, Body>()

/** Starts loading a declared sheet's body; safe to call many times. */
export function preloadSheet(id: string): Promise<{ default: Body }> | null {
  const declaration = declaredSheet(id)
  if (!declaration) return null
  let promise = started.get(id)
  if (!promise) {
    promise = declaration.load() as Promise<{ default: Body }>
    promise.then(
      (module) => {
        loaded.set(id, module.default)
      },
      () => {}
    )
    // A failed load is forgotten, so Try again loads afresh.
    promise.catch(() => {
      started.delete(id)
      lazies.delete(id)
    })
    started.set(id, promise)
  }
  return promise
}

/** The body of a declared sheet whose code has arrived, or undefined. */
export function loadedSheetBody(id: string): Body | undefined {
  return loaded.get(id)
}

/** The lazy body for a declared sheet; a new one after a failed load. */
export function lazySheetBody(id: string): Body {
  let body = lazies.get(id)
  if (!body) {
    body = lazy(() => preloadSheet(id) ?? Promise.reject(new Error(id)))
    lazies.set(id, body)
  }
  return body
}

/** Forgets a failed load so the next render tries again. */
export function forgetSheet(id: string) {
  started.delete(id)
  lazies.delete(id)
  loaded.delete(id)
}
