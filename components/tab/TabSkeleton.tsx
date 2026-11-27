import { TAB_PAGE } from '@/lib/copy/tab'

/** Placeholder while the tab screens load; no payment code. */
export function TabSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="tab-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{TAB_PAGE.loading}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{ width: `${[60, 90, 75, 40][i % 4]}%` }}
        />
      ))}
    </div>
  )
}
