'use client'

export function AuthorNotFoundIllustration() {
  return (
    <div className="mx-auto mb-6 w-full max-w-[220px]">
      <svg
        viewBox="0 0 200 168"
        className="h-auto w-full"
        aria-hidden
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle
          cx="100"
          cy="52"
          r="28"
          className="fill-card stroke-border"
          strokeWidth="2"
        />
        <path
          d="M56 120c8-22 28-34 44-34s36 12 44 34"
          className="fill-none stroke-border"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="88"
          y1="48"
          x2="112"
          y2="56"
          className="stroke-muted-foreground/70"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <line
          x1="112"
          y1="48"
          x2="88"
          y2="56"
          className="stroke-muted-foreground/70"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M158 36l18 18M176 36l-18 18"
          className="stroke-primary"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}
