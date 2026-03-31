import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="h-14 w-full border-b border-border px-4 flex items-center gap-4">
        <Skeleton className="h-8 w-28" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="flex flex-1 items-start justify-center px-4 py-16">
        <div className="flex w-full max-w-3xl flex-col gap-6">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}
