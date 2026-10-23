import Link from 'next/link'
import { FailurePageShell } from '@/components/error/FailurePageShell'
import { Button } from '@/components/ui/button'
import { NotFoundIllustration } from '@/components/error/NotFoundIllustration'

export default function NotFound() {
  return (
    <FailurePageShell
      illustration={<NotFoundIllustration />}
      heading={
        <>
          <h1 className="font-display text-5xl font-medium tracking-[-0.01em] text-foreground sm:text-6xl">
            404
          </h1>
          <h2 className="font-display text-2xl font-medium text-foreground">
            Page not found
          </h2>
        </>
      }
      description="Sorry, we couldn't find the page you're looking for."
      actionsClassName="flex flex-col items-center gap-4 sm:flex-col"
      actions={
        <>
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/">Go Home</Link>
          </Button>
          <Link
            href="/articles"
            className="text-sm font-medium text-primary underline-offset-4 transition-colors hover:underline"
          >
            Browse articles
          </Link>
        </>
      }
    />
  )
}
