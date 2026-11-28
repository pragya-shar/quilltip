/**
 * The loading state of the signed-in sections (dashboard, writing desk,
 * drafts, library, settings, welcome, ops, profile): each section's
 * loading.tsx renders it while a page loads, including on client navigation.
 *
 * Public reading pages (`/`, `/articles`, a writer's page and an article)
 * have no loading boundary on purpose. With one, React streams a large page
 * as a hidden segment that only a script reveals, so a reader whose scripts
 * never run sees nothing but this status (#428).
 */
export function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-label="Loading page">
      <span className="route-loading-mark" aria-hidden="true" />
      <p>Loading page…</p>
    </div>
  )
}
