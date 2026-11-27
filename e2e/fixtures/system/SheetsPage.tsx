import { sheetStack } from '../../../shell/sheetStack'
import { warmSheet } from '../../../shell/sheets/preload'

/** Openers for the declared demo sheets (fixture route /sheets). */
export function SheetsPage() {
  return (
    <div className="qt-page">
      <button
        type="button"
        className="qt-button"
        data-variant="secondary"
        {...warmSheet('demo-lazy')}
        onClick={() => sheetStack.open('demo-lazy', { amount: '$3' })}
      >
        Open the lazy sheet
      </button>
      <button
        type="button"
        className="qt-button"
        data-variant="secondary"
        onClick={() => sheetStack.open('demo-broken')}
      >
        Open the sheet that fails once
      </button>
    </div>
  )
}
