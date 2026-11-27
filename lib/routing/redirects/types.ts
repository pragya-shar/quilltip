/**
 * One permanent redirect (308) from a legacy path, answered by proxy.ts
 * before anything else. `from` is an exact pathname. `to` is a path, or a
 * function of the request URL that returns a path (with its query) or null
 * when this request is not redirected (for example `/write?id=<id>` goes to
 * `/write/<id>` only when `id` is set). `keepQuery` carries the request's
 * query over to a fixed `to` (for example `?next=` to `/signin`).
 */
export type Redirect = {
  from: string
  to: string | ((url: URL) => string | null)
  keepQuery?: boolean
}
