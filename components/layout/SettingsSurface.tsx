import { cn } from '@/lib/utils'

type SettingsSurfaceProps = {
  children: React.ReactNode
  className?: string
}

export function SettingsSurface({ children, className }: SettingsSurfaceProps) {
  return (
    <div
      className={cn('mx-auto w-full max-w-2xl', className)}
      style={{ maxWidth: 'var(--surface-settings-max)' }}
    >
      {children}
    </div>
  )
}
