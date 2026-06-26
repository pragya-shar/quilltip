import { cn } from '@/lib/utils'

type WorkspaceSurfaceProps = {
  children: React.ReactNode
  className?: string
}

export function WorkspaceSurface({
  children,
  className,
}: WorkspaceSurfaceProps) {
  return (
    <div
      className={cn('mx-auto w-full max-w-5xl px-4 pt-24 pb-8', className)}
      style={{ maxWidth: 'var(--surface-workspace-max)' }}
    >
      {children}
    </div>
  )
}
