'use client'

export function CreatorWorkspacePanelFallback() {
  return (
    <div className="rounded-lg border border-border bg-muted p-6 text-center">
      <p className="font-medium text-foreground">
        Workspace panel unavailable.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        You can still write, publish, and manage your wallet.
      </p>
    </div>
  )
}
