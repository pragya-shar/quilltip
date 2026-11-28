import type { SheetBodyProps } from '../../../shell/sheets'

/** A lazily loaded sheet body for the fixture. */
export default function DemoSheetBody({
  props,
  close,
}: SheetBodyProps<{ amount?: string }>) {
  return (
    <div>
      <p>Loaded on demand{props?.amount ? ` for ${props.amount}` : ''}.</p>
      <button
        type="button"
        className="qt-button"
        data-variant="primary"
        onClick={close}
      >
        Done
      </button>
    </div>
  )
}
