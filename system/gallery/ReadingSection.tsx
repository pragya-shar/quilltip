import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Heading } from '../components/Heading'
import { PassageMark } from '../components/PassageMark'
import { Prose } from '../components/Prose'
import { Skeleton } from '../components/Skeleton'
import { Text } from '../components/Text'
import { BalanceIcon } from '../icons'
import { GallerySection } from './GallerySection'
import { Specimen } from './Specimen'

/** Reading typography, passage marks, skeletons and empty states. */
export function ReadingSection() {
  return (
    <GallerySection id="reading" title="Reading, marks and empty places">
      <Specimen name="Article" wide>
        <article className="qt-gallery__article">
          <Heading level={3} variant="display">
            What my grandmother’s ledger taught me about money
          </Heading>
          <Text as="p" size="ui-s" tone="ink-2">
            Tomás Reyes · 6 min
          </Text>
          <Prose>
            <p>
              My grandmother kept a ledger in the drawer under the bread. It was
              not a budget.{' '}
              <PassageMark
                heat={3}
                total="$14 · 23"
                totalLabel="$14 from 23 tips"
              >
                She wrote down every coin she ever gave away.
              </PassageMark>{' '}
              Not to remember the money, but to remember the people.
            </p>
            <p>
              <PassageMark
                heat={2}
                total="$4 · 9"
                totalLabel="$4 from 9 tips"
                targeted
              >
                Two pesos to the boy who carried her bags.
              </PassageMark>{' '}
              Five to Señora Ruiz, <em>for the medicine</em>. One to a singer on
              the 14 bus.
            </p>
            <blockquote>
              <PassageMark heat={1} total="$1 · 1" totalLabel="$1 from 1 tip">
                When she died we read it aloud.
              </PassageMark>
            </blockquote>
          </Prose>
        </article>
      </Specimen>
      <Specimen name="Right to left">
        <div dir="rtl" lang="ar">
          <Prose variant="line">
            <PassageMark heat={3} total="$2 · 3" totalLabel="$2 from 3 tips">
              كتبت كل عملة أعطتها.
            </PassageMark>
          </Prose>
        </div>
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
