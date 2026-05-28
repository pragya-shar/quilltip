'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type LoadingRegionProps = {
  label: string
  isLoading: boolean
  isStale: boolean
  onRetry: () => void
  fallback: ReactNode
  children: ReactNode
  className?: string
}

export function LoadingRegion({
  label,
  isLoading,
  isStale,
  onRetry,
  fallback,
  children,
  className,
}: LoadingRegionProps) {
  const prevIsLoadingRef = useRef<boolean>(false)
  const [announcement, setAnnouncement] = useState<string>('')

  const liveText = useMemo(() => {
    if (!announcement) return ''
    return announcement
  }, [announcement])

  useEffect(() => {
    const prevIsLoading = prevIsLoadingRef.current
    prevIsLoadingRef.current = isLoading

    if (isLoading && !prevIsLoading) {
      setAnnouncement(`Loading ${label}.`)
      return
    }

    if (!isLoading && prevIsLoading) {
      setAnnouncement(`${label} loaded.`)
    }
  }, [isLoading, label])

  return (
    <div
      className={className}
      aria-busy={isLoading && !isStale ? true : undefined}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {liveText}
      </p>

      {isLoading ? (
        isStale ? (
          <div
            role="alert"
            className={cn(
              'mx-auto max-w-2xl rounded-lg border border-border bg-muted p-6 text-center',
              className
            )}
          >
            <p className="font-medium text-foreground">
              Still loading {label}.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              This is taking longer than expected. Try again, or reload the
              page.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button
                type="button"
                onClick={onRetry}
                className="min-w-[9.5rem]"
              >
                Try again
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Reload page
              </Button>
            </div>
          </div>
        ) : (
          <div aria-hidden>{fallback}</div>
        )
      ) : (
        children
      )}
    </div>
  )
}
