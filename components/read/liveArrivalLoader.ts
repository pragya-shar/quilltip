import type { ComponentType } from 'react'
import type { Id } from '@/convex/_generated/dataModel'

/**
 * What the article view gives the Write package's arrival, the moment
 * after a first publish (`liveArrival.ts` decides when it runs).
 */
export type LiveArrivalProps = {
  articleId: Id<'articles'>
  /** The server-rendered title, `#read-title`: animate it, never its text. */
  title: HTMLElement
  /** The canonical article URL, `/{username}/{slug}`. */
  href: string
  /** The link to one line: `${href}#s-{p}-{k}`. */
  lineHref: (paragraph: number, sentence: number) => string
  /** Call when the arrival is over; the view unmounts it. */
  done: () => void
}

export type LiveArrivalModule = { default: ComponentType<LiveArrivalProps> }

/**
 * The Write package's arrival, loaded only when it runs, so readers never
 * download it. Null until Write ships it: the arrival then does nothing.
 * The Write pull request changes this one line to its `import()`.
 */
export const loadLiveArrival: null | (() => Promise<LiveArrivalModule>) = null
