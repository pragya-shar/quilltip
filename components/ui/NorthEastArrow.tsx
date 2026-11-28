import { cn } from '@/lib/utils'

/**
 * The arrow after a link or button label that leads on (#666). The character
 * U+2197 (north east arrow) can be drawn as a colour emoji tile on iPhone;
 * this drawing is the same thin arrow, in the text colour, in every browser.
 * It is decoration, so assistive technology skips it.
 */
export function NorthEastArrow({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-arrow="north-east"
      className={cn(
        'inline-block size-[0.85em] shrink-0 align-[-0.05em]',
        className
      )}
    >
      <path d="M2.5 13.5 13.5 2.5M7.5 2.5h6v6" />
    </svg>
  )
}
