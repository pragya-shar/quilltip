import SampleReadingPage from '../../../app/(app)/(public)/system/reading/page'
import { sheetStack } from '../../../shell/sheetStack'

// An article (a pushed screen: the phone bar is hidden) with two stand-ins
// for the Read surface's tip bar: its balance caption, which opens the
// balance over the article, and a tip the balance cannot cover, which opens
// Add money with the tip it needs.
export function ArticleStandIn() {
  return (
    <>
      <SampleReadingPage />
      <div
        style={{
          position: 'fixed',
          insetInlineEnd: 16,
          insetBlockStart: 72,
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          type="button"
          className="qt-button"
          data-variant="secondary"
          data-fixture="balance-caption"
          onClick={() => sheetStack.open('pocket')}
        >
          <span className="qt-button__label">Balance</span>
        </button>
        <button
          type="button"
          className="qt-button"
          data-variant="secondary"
          data-fixture="needs-funds"
          onClick={() =>
            sheetStack.open('add-money', {
              need: { cents: 100, display: '$1.00' },
            })
          }
        >
          <span className="qt-button__label">Tip $1</span>
        </button>
      </div>
    </>
  )
}
