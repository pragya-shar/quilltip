'use client'

export function CreatorWorkspaceLoadingShell() {
  return (
    <div className="animate-pulse">
      <div className="mb-8 space-y-3">
        <div className="h-9 w-64 rounded-lg bg-muted" />
        <div className="h-5 w-48 rounded-lg bg-muted" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-8">
          <div className="h-36 rounded-[var(--card-radius)] bg-muted" />
          <div>
            <div className="mb-4 h-6 w-40 rounded-lg bg-muted" />
            <div className="space-y-2">
              {[0, 1, 2].map((key) => (
                <div
                  key={key}
                  className="h-16 rounded-[var(--card-radius)] bg-muted"
                />
              ))}
            </div>
          </div>
        </div>
        <div className="h-36 rounded-[var(--card-radius)] bg-muted" />
      </div>
    </div>
  )
}
