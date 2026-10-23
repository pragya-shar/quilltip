import Link from 'next/link'
import { FailurePageShell } from '@/components/error/FailurePageShell'

export default function NotFound() {
  return (
    <main>
      <FailurePageShell
        label="404 · Page not found"
        heading={<h1 className="failure-heading">This page is missing.</h1>}
        description="We couldn’t find the page you’re looking for. Head home or find something new to read."
        actions={
          <>
            <Link href="/" className="failure-action">
              Go home
            </Link>
            <Link href="/articles" className="failure-link">
              Browse articles
            </Link>
          </>
        }
      />
    </main>
  )
}
