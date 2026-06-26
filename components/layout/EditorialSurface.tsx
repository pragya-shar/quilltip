import { cn } from '@/lib/utils'

type EditorialSurfaceProps = {
  children: React.ReactNode
  className?: string
}

export function EditorialSurface({
  children,
  className,
}: EditorialSurfaceProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[var(--surface-editorial-max)] px-4 py-8',
        className
      )}
    >
      {children}
    </div>
  )
}
