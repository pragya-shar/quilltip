import Link from 'next/link'
import { cn } from '@/lib/utils'

type LegalLinksProps = {
  className?: string
  linkClassName?: string
  variant?: 'inline' | 'stacked'
  /** How to separate inline links: pipe (footer) or and (auth copy). */
  conjunction?: 'pipe' | 'and'
}

export function LegalLinks({
  className,
  linkClassName,
  variant = 'inline',
  conjunction = 'pipe',
}: LegalLinksProps) {
  const linkStyles = cn(
    'hover:underline underline-offset-4 transition-colors',
    linkClassName
  )

  if (variant === 'stacked') {
    return (
      <nav className={cn('flex flex-col gap-2 text-sm', className)}>
        <Link href="/terms" className={linkStyles}>
          Terms of Service
        </Link>
        <Link href="/privacy" className={linkStyles}>
          Privacy Policy
        </Link>
      </nav>
    )
  }

  const separator =
    conjunction === 'and' ? (
      <span className="text-muted-foreground"> and </span>
    ) : (
      <span className="mx-1.5 text-muted-foreground" aria-hidden>
        |
      </span>
    )

  return (
    <span className={className}>
      <Link href="/terms" className={linkStyles}>
        Terms of Service
      </Link>
      {separator}
      <Link href="/privacy" className={linkStyles}>
        Privacy Policy
      </Link>
    </span>
  )
}
