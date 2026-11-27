/**
 * Whether the first page of this visit has shown. A pushed screen that
 * mounts later arrived by navigation and may slide in; the first page never
 * animates (D19).
 */
let shown = false

export const firstPage = {
  shown: () => shown,
  markShown() {
    shown = true
  },
}
