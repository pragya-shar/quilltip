import { cn } from '@/lib/utils'

type ErrorPageIllustrationProps = {
  className?: string
}

export function ErrorPageIllustration({ className }: ErrorPageIllustrationProps) {
  return (
    <svg
      className={cn('mx-auto h-40 w-40 shrink-0', className)}
      viewBox="0 0 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="28"
        y="24"
        width="88"
        height="112"
        rx="6"
        className="fill-white stroke-quill-200"
        strokeWidth="2"
      />
      <path
        d="M44 48h56M44 64h48M44 80h52M44 96h40"
        className="stroke-quill-300"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M44 112h28"
        className="stroke-quill-200"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M98 88c12-8 28-32 34-48 2-6-2-12-8-10-14 4-36 26-44 40-4 8-2 18 6 22 8 4 18 2 22-6l10-18"
        className="fill-brand-accent/20 stroke-brand-accent"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M88 102l-6 14 8-4 6-14-8 4Z"
        className="fill-brand-blue stroke-brand-blue"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M96 94c-2 4-6 10-10 14"
        className="stroke-brand-blue"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
