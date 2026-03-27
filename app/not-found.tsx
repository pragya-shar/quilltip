import Link from 'next/link'

import { Button } from '@/components/ui/button'

function NotFoundIllustration() {
  return (
    <div className="mx-auto w-full max-w-[220px]">
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
          className="fill-brand-cream stroke-brand-blue"
          strokeWidth="2"
        />
        <path
          d="M132 28h36v36l-36-36z"
          className="fill-brand-accent/20 stroke-brand-blue"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <line
          x1="48"
          y1="52"
          x2="118"
          y2="52"
          className="stroke-quill-300"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="48"
          y1="68"
          x2="104"
          y2="68"
          className="stroke-quill-300"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="48"
          y1="84"
          x2="110"
          y2="84"
          className="stroke-quill-300"
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
          className="fill-brand-blue/15 stroke-brand-blue"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <circle cx="139" cy="74" r="2" className="fill-brand-blue" />
      </svg>
    </div>
  )
}

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 text-center">
        <NotFoundIllustration />
        <div className="space-y-2">
          <h1 className="font-display text-5xl font-medium tracking-[-0.01em] text-brand-blue sm:text-6xl">
            404
          </h1>
          <h2 className="font-display text-2xl font-medium text-foreground">
            Page not found
          </h2>
          <p className="font-sans text-quill-700">
            Sorry, we couldn&apos;t find the page you&apos;re looking for.
          </p>
        </div>
        <div className="flex w-full flex-col items-center gap-4 sm:w-auto">
          <Button
            asChild
            size="lg"
            className="bg-brand-blue text-white shadow hover:bg-brand-accent focus-visible:ring-brand-blue"
          >
            <Link href="/">Go Home</Link>
          </Button>
          <Link
            href="/articles"
            className="text-sm text-brand-blue underline-offset-4 transition-colors hover:text-brand-accent hover:underline"
          >
            Browse articles
          </Link>
        </div>
      </div>
    </div>
  )
}
