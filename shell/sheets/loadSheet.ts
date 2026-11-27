import { lazy, type ComponentType } from 'react'
import { declaredSheet, type SheetBodyProps } from '.'

type Body = ComponentType<SheetBodyProps<unknown>>

const started = new Map<string, Promise<{ default: Body }>>()
const lazies = new Map<string, ComponentType<SheetBodyProps<unknown>>>()

/** Starts loading a declared sheet's body; safe to call many times. */
export function preloadSheet(id: string): Promise<{ default: Body }> | null {
  const declaration = declaredSheet(id)
  if (!declaration) return null
  let promise = started.get(id)
  if (!promise) {
    promise = declaration.load() as Promise<{ default: Body }>
    // A failed load is forgotten, so Try again loads afresh.
    promise.catch(() => {
      started.delete(id)
      lazies.delete(id)
    })
    started.set(id, promise)
  }
  return promise
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
}
