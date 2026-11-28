/**
 * The words of ReadingUnavailable, in one module, so the outage copy can
 * replace them with one import when it reaches the base. Plain strings and
 * one function: no component imports.
 */
export const READING_UNAVAILABLE_COPY = {
  /** The heading: what could not load, then this. */
  title: (what: string) => `${what} could not be loaded right now.`,
  body: 'Quilltip did not answer in time. Try again in a moment.',
  retry: 'Try again',
} as const
