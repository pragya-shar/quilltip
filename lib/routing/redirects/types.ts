/**
 * A permanent (308) redirect from an old path. `from` matches the exact
 * path, with or without a trailing slash. `to` gets the request URL and
 * returns the new path and query; the old query is not carried over unless
 * `to` carries it.
 */
export type Redirect = {
  from: string
  to: (url: URL) => string
}
