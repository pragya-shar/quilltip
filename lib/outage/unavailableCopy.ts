/**
 * The words of the "could not be loaded" state, shared by the in-page
 * fallback (components/articles/ReadingUnavailable.tsx) and the outage
 * response (lib/outage), so a reader sees one message (#428, #609).
 * It says only what is true: the page could not load now, nothing was lost,
 * try again.
 */
export const UNAVAILABLE_WHAT = {
  articles: 'The articles',
  writer: 'This writer’s page',
  article: 'This article',
} as const

export function unavailableHeading(what: string): string {
  return `${what} could not be loaded right now.`
}

export const UNAVAILABLE_DETAIL =
  'Quilltip did not answer in time. Nothing was lost. Please try again in a moment.'

export const UNAVAILABLE_RETRY = 'Try again'
