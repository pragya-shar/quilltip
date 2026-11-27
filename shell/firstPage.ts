/**
 * What this visit has done so far. A pushed screen that mounts after the
 * first page arrived by navigation and may slide in; the first page never
 * animates. Back returns through history only after an in-app
 * navigation; otherwise it would leave the application.
 */
let shown = false
let navigated = false

export const firstPage = {
  shown: () => shown,
  markShown() {
    shown = true
  },
  /** True once the person moved between pages inside the application. */
  navigated: () => navigated,
  markNavigated() {
    navigated = true
  },
}
