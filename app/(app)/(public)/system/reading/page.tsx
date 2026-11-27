import type { Metadata } from 'next'
import '@/system/gallery/gallery.css'
import { Avatar } from '@/system/components/Avatar'
import { Heading } from '@/system/components/Heading'
import { PassageMark } from '@/system/components/PassageMark'
import { Prose } from '@/system/components/Prose'
import { TextLink } from '@/system/components/TextLink'
import { SampleTipDock } from '@/system/gallery/SampleTipDock'
import { PushedHeader } from '@/shell/PushedHeader'
import { PushedScreen } from '@/shell/PushedScreen'

export const metadata: Metadata = {
  title: 'Reading page sample',
  robots: { index: false, follow: false },
}

/**
 * A public reading page built the required way (D19), on sample text: the
 * article is server HTML in the first response, links are plain links, and
 * the tip control is an island beside the text. The no-script suite runs
 * against it until the real article page lands.
 */
export default function SampleReadingPage() {
  return (
    <PushedScreen>
      <div className="qt-page qt-sample" data-width="read">
        <PushedHeader fallbackHref="/" backLabel="Back to reading" />
        <article className="qt-sample__article">
          <Heading level={1} variant="display">
            What my grandmother’s ledger taught me about money
          </Heading>
          <p className="qt-sample__byline">
            <Avatar name="Tomás Reyes" size={24} decorative />
            <span>Tomás Reyes</span>
            <span aria-hidden="true">·</span>
            <span>6 min</span>
          </p>
          <Prose leadIn>
            <p>
              My grandmother kept a ledger in the drawer under the bread. It was
              not a budget. There were no columns for rent or groceries, and the
              totals never added up to anything.
            </p>
            <p>
              <PassageMark state="others" count={9}>
                Two pesos to the boy who carried her bags.
              </PassageMark>{' '}
              For thirty years she wrote one line each time she gave something
              away: a date, a name, a coin. Five to Señora Ruiz,{' '}
              <em>for the medicine</em>. One to a singer on the 14 bus.
            </p>
            <p>
              <PassageMark state="others-top" count={23}>
                She wrote down every coin she ever gave away. Not to remember
                the money, but to remember the people.
              </PassageMark>
            </p>
            <p>
              When she died we read it aloud, one line each, around the table.
              Nobody cried until the singer on the 14 bus.
            </p>
          </Prose>
          <footer className="qt-sample__end">
            <TextLink href="/articles" variant="standalone">
              Read more articles
            </TextLink>
          </footer>
        </article>
        <SampleTipDock />
      </div>
    </PushedScreen>
  )
}
