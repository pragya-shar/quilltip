import type { Metadata } from 'next'
import './globals.css'
import { FailurePageShell } from '@/components/error/FailurePageShell'

// A URL that matches no route in either root layout (Next.js renders this
// file when there is no single root layout). Server HTML only: no client
// component, so it adds nothing to any route's first-load JavaScript. Writer
// and article URLs never reach it; app/(legacy)/[username] answers those.
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
}

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-background text-foreground">
        <main>
          <FailurePageShell
            label="404 · Page not found"
            heading={<h1 className="failure-heading">This page is missing.</h1>}
            description="We couldn’t find the page you’re looking for. Head home or find something new to read."
            actions={
              // Plain links: this page has no router, and a full page load
              // is what a lost reader needs. It also keeps client code out.
              /* eslint-disable @next/next/no-html-link-for-pages */
              <>
                <a href="/" className="failure-action">
                  Go home
                </a>
                <a href="/articles" className="failure-link">
                  Browse articles
                </a>
              </>
              /* eslint-enable @next/next/no-html-link-for-pages */
            }
          />
        </main>
      </body>
    </html>
  )
}
