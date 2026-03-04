'use client'

import Link from 'next/link'

/** Quill / pen nib outline: oval with hole and two tines */
function QuillIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 5c-2.5 0-4 1.8-4 4s1 4 4 5c3-1 4-2.5 4-5s-1.5-4-4-4z" />
      <circle cx="12" cy="8.5" r="1.25" />
    </svg>
  )
}

export interface LogoProps {
  /** Link to home. Omit to render as div (e.g. in footer) */
  href?: string
  /** 'dark' = dark icon + dark text (light bg). 'light' = light icon + light text (dark bg) */
  variant?: 'dark' | 'light'
  /** Show text "QuillTip" next to icon */
  showText?: boolean
  /** Size of the icon box */
  iconSize?: 'sm' | 'md' | 'lg'
  /** Optional class for the container */
  className?: string
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
  href = '/',
  variant = 'dark',
  showText = true,
  iconSize = 'md',
  className = '',
}: LogoProps) {
  const isDark = variant === 'dark'
  const boxBg = isDark
    ? 'bg-neutral-900'
    : 'bg-neutral-700'
  const iconColor = 'text-white'
  const textColor = isDark ? 'text-neutral-900' : 'text-white'
  const textFont = isDark ? 'font-semibold' : 'font-medium'

  const content = (
    <>
      <span
        className={`${iconSizeClasses[iconSize]} ${boxBg} rounded-xl flex items-center justify-center shrink-0 ${isDark ? 'shadow-sm' : 'shadow-lg'}`}
      >
        <QuillIcon className={`${iconInnerClasses[iconSize]} ${iconColor}`} />
      </span>
      {showText && (
        <span className={`${textSizeClasses[iconSize]} ${textFont} ${textColor} tracking-tight`}>
          QuillTip
        </span>
      )}
    </>
  )

  const sharedClass = `inline-flex items-center gap-3 ${className}`

  if (href) {
    return (
      <Link href={href} className={`${sharedClass} hover:opacity-90 transition-opacity`}>
        {content}
      </Link>
    )
  }

  return <div className={sharedClass}>{content}</div>
}
