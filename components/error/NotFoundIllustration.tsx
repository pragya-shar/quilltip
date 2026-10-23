export function NotFoundIllustration() {
  return (
    <div className="mx-auto mb-6 w-full max-w-[220px]">
      <svg
        viewBox="0 0 200 168"
        className="h-auto w-full"
        aria-hidden
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          x="32"
          y="28"
          width="116"
          height="92"
          rx="8"
          className="fill-card stroke-border"
          strokeWidth="2"
        />
        <path
          d="M132 28h36v36l-36-36z"
          className="fill-brand-accent/20 stroke-border"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <line
          x1="48"
          y1="52"
          x2="118"
          y2="52"
          className="stroke-muted-foreground/60"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="48"
          y1="68"
          x2="104"
          y2="68"
          className="stroke-muted-foreground/60"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="48"
          y1="84"
          x2="110"
          y2="84"
          className="stroke-muted-foreground/60"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M168 18c6 14 2 32-12 46l-14 18"
          className="fill-none stroke-brand-accent"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M142 80l-10 26 8 4 10-24c4-10 3-22-4-30"
          className="fill-primary/15 stroke-primary"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <circle cx="139" cy="74" r="2" className="fill-primary" />
      </svg>
    </div>
  )
}
