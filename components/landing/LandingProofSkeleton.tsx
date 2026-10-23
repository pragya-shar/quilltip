'use client'

export function LandingProofSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className="h-[72px] animate-pulse rounded-lg border border-border bg-muted/50" />
      <div className="hidden h-[72px] animate-pulse rounded-lg border border-border bg-muted/50 sm:block" />
    </div>
  )
}
