import { Button } from '@/system/components/Button'
import { Notice } from '@/system/components/Notice'

/**
 * Today when the server read did not answer in time (D21): a plain message
 * and a plain "Try again" link, readable with no script, and never indexed.
 * The page still answers 200 inside the shell, and dynamic pages are sent
 * with no-store, so nothing caches this state.
 *
 * The smallest local version. Replace the body with the shared unreachable
 * component the article view is building, when its path is known; the one
 * import of this file is in TodayView.
 */
export function TodayUnreachable() {
  return (
    <>
      {/* React places this in the document head. */}
      <meta name="robots" content="noindex" />
      <Notice
        tone="failure"
        title="Today’s article did not load."
        action={
          <Button href="/" variant="secondary">
            Try again
          </Button>
        }
      >
        Quilltip did not answer in time. Check your connection, then try again.
      </Notice>
    </>
  )
}
