import { cn } from '@/lib/utils'

type GuideSurfaceProps = {
  children: React.ReactNode
  className?: string
}

export function GuideSurface({ children, className }: GuideSurfaceProps) {
  return (
    <div className={cn('mx-auto w-full max-w-3xl', className)}>{children}</div>
  )
}
