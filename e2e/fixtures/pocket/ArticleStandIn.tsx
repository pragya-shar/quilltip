import SampleReadingPage from '../../../app/(app)/(public)/system/reading/page'
import { sheetStack } from '../../../shell/sheetStack'

// An article (a pushed screen: the phone bar is hidden) with the tip bar's
// balance caption standing in for the Read surface's: it opens the Pocket
// over the article, as the caption will.
export function ArticleStandIn() {
  return (
    <>
      <SampleReadingPage />
      <button
        type="button"
        className="qt-button"
        data-variant="secondary"
        data-fixture="balance-caption"
        style={{ position: 'fixed', insetInlineStart: 16, insetBlockStart: 72 }}
        onClick={() => sheetStack.open('pocket')}
      >
        <span className="qt-button__label">Balance</span>
      </button>
    </>
  )
}
