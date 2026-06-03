import { Skeleton } from '@/components/ui/skeleton'

export function EditorChromeSkeleton() {
  return (
    <div className="flex flex-col pt-16" aria-hidden>
      <div className="sticky top-16 z-40 bg-background border-b border-border w-full mb-6 px-4 py-3">
        <div className="max-w-5xl mx-auto flex gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-24 ml-auto" />
        </div>
      </div>
      <div className="max-w-3xl mx-auto w-full px-4 space-y-6 flex-1">
        <Skeleton className="h-12 w-full max-w-2xl" />
        <Skeleton className="h-[min(60vh,520px)] w-full rounded-md" />
      </div>
    </div>
  )
}
