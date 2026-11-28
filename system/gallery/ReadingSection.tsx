import Link from 'next/link'
import { prefetchFor } from '@/lib/routing/legacyRoutes'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Heading } from '../components/Heading'
import { PassageMark } from '../components/PassageMark'
import { Prose } from '../components/Prose'
import { ReadingUnavailable } from '../components/ReadingUnavailable'
import { Skeleton } from '../components/Skeleton'
import { Text } from '../components/Text'
import { BalanceIcon } from '../icons'
import { GallerySection } from './GallerySection'
import { Specimen } from './Specimen'

const STEADY_STATES = ['chosen', 'holding', 'mine'] as const

/** Reading typography, passage marks, skeletons and empty states. */
export function ReadingSection() {
  return (
    <GallerySection id="reading" title="Reading, marks and empty places">
      <Specimen
        name="Article: lead-in, marks (others top, chosen, mine, others, kept, holding, share line), footnote"
        wide
      >
        <article className="qt-gallery__article">
          <Heading level={3} variant="display">
            What my grandmother’s ledger taught me about money
          </Heading>
          <Text as="p" size="ui-s" tone="ink-2">
            Tomás Reyes · 6 min
          </Text>
          <Prose leadIn>
            <p>
              My grandmother kept a ledger in the drawer under the bread. It was
              not a budget.{' '}
              <PassageMark state="others-top" count={23}>
                She wrote down every coin she ever gave away.
              </PassageMark>{' '}
              Not to remember the money, but to remember the people.
            </p>
            <p>
              <PassageMark state="chosen">
                Two pesos to the boy who carried her bags.
              </PassageMark>{' '}
              Five to Señora Ruiz, <em>for the medicine</em>.{' '}
              <PassageMark state="mine">
                One to a singer on the 14 bus.
              </PassageMark>
            </p>
            <p>
              <PassageMark state="others" count={2}>
                For thirty years she wrote one line each time she gave something
                away.
              </PassageMark>{' '}
              <PassageMark state="kept">A date, a name, a coin.</PassageMark>
              <Link
                className="qt-fn-ref"
                href="/system/reading#fn-1"
                prefetch={prefetchFor('/system/reading')}
                id="fnref-1"
              >
                1
              </Link>
            </p>
            <p>
              <PassageMark state="holding">
                When she died we read it aloud, one line each, around the table.
              </PassageMark>{' '}
              <PassageMark state="share-line">
                Nobody cried until the singer on the 14 bus.
              </PassageMark>
            </p>
            <ol className="qt-footnotes">
              <li id="fn-1">
                The ledger is now in a shoebox in my mother’s closet.{' '}
                <Link
                  href="/system/reading#fnref-1"
                  prefetch={prefetchFor('/system/reading')}
                  aria-label="Back to the text"
                >
                  ↩
                </Link>
              </li>
            </ol>
          </Prose>
        </article>
      </Specimen>
      <Specimen name="A line changing state keeps every line break" wide>
        <div className="qt-gallery__steady">
          {STEADY_STATES.map((state) => (
            <Prose key={state}>
              <p data-steady={state}>
                She wrote down{' '}
                <PassageMark state={state}>
                  every coin she gave away, and to whom, and why it mattered to
                  her that week
                </PassageMark>{' '}
                and then she closed the drawer.
              </p>
            </Prose>
          ))}
        </div>
      </Specimen>
      <Specimen name="Right to left">
        <div dir="rtl" lang="ar">
          <Prose variant="line">
            <PassageMark state="others-top" count={3}>
              كتبت كل عملة أعطتها.
            </PassageMark>
          </Prose>
        </div>
      </Specimen>
      <Specimen name="Could not reach">
        <ReadingUnavailable
          what="This article"
          retryHref="/system/reading"
          headingLevel={2}
        />
      </Specimen>
      <Specimen name="Skeleton">
        <div
          className="qt-gallery__stack"
          aria-busy="true"
          aria-label="Loading activity"
        >
          <div className="qt-gallery__row">
            <Skeleton shape="circle" />
            <div className="qt-gallery__stack" style={{ flex: 1 }}>
              <Skeleton width="60%" />
              <Skeleton width="85%" />
            </div>
          </div>
          <Skeleton shape="block" />
        </div>
      </Specimen>
      <Specimen name="Empty state">
        <EmptyState
          icon={BalanceIcon}
          title="Your tips show up here."
          action={<Button variant="primary">Add money</Button>}
        />
      </Specimen>
    </GallerySection>
  )
}
