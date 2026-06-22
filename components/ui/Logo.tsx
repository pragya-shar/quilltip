'use client'

import Link from 'next/link'
import { PenTool } from 'lucide-react'
import { motion } from 'motion/react'

export interface LogoProps {
  /** Link target. Omit for home (`/`). Pass `null` for a static, non-link lockup. */
  href?: string | null
  /** `default` for light backgrounds; `onDark` for spotlight/dark footer surfaces. */
  variant?: 'default' | 'onDark'
  /** Show "Quilltip" wordmark next to icon. */
  showText?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** Spring hover scale on the icon box (landing nav only). */
  animated?: boolean
  className?: string
  onClick?: () => void
}

const iconSizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-9 h-9',
  lg: 'w-11 h-11',
}

const iconInnerClasses = {
  sm: 'w-4 h-4',
  md: 'w-[18px] h-[18px]',
  lg: 'w-5 h-5',
}

const textSizeClasses = {
  sm: 'text-lg',
  md: 'text-[22px]',
  lg: 'text-2xl',
}

export function Logo({
  href,
  variant = 'default',
  showText = true,
  size = 'md',
  animated = false,
  className = '',
  onClick,
}: LogoProps) {
  const isOnDark = variant === 'onDark'
  const iconBoxClass = isOnDark
    ? 'bg-card border border-border shadow-sm'
    : 'bg-gradient-to-br from-brand-blue to-brand-accent shadow-sm'
  const iconColor = isOnDark ? 'text-foreground' : 'text-brand-foreground'
  const textColor = isOnDark ? 'text-spotlight-foreground' : 'text-foreground'
  const textFont = isOnDark ? 'font-medium font-display' : 'font-semibold'

  const iconBox = (
    <span
      className={`${iconSizeClasses[size]} ${iconBoxClass} rounded-xl flex items-center justify-center shrink-0`}
    >
      <PenTool
        className={`${iconInnerClasses[size]} ${iconColor}`}
        aria-hidden
      />
    </span>
  )

  const content = (
    <>
      {animated ? (
        <motion.span
          className={`${iconSizeClasses[size]} ${iconBoxClass} rounded-xl flex items-center justify-center shrink-0`}
          whileHover={{ scale: 1.05 }}
          transition={{ type: 'spring', stiffness: 400, damping: 10 }}
        >
          <PenTool
            className={`${iconInnerClasses[size]} ${iconColor}`}
            aria-hidden
          />
        </motion.span>
      ) : (
        iconBox
      )}
      {showText && (
        <span
          className={`${textSizeClasses[size]} ${textFont} ${textColor} tracking-tight`}
        >
          Quilltip
        </span>
      )}
    </>
  )

  const sharedClass = `inline-flex items-center gap-3 ${className}`
  const linkHref = href === undefined ? '/' : href

  if (linkHref !== null) {
    return (
      <Link
        href={linkHref}
        onClick={onClick}
        className={`${sharedClass} focus-ring rounded-lg hover:opacity-90 transition-opacity`}
        aria-label="Quilltip"
      >
        {content}
      </Link>
    )
  }

  return <div className={sharedClass}>{content}</div>
}
