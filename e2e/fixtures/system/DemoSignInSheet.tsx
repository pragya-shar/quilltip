import { Sheet } from '../../../system/components/Sheet'
import type { SheetComponentProps } from '../../../shell/sheetRegistry'

/** A stand-in sign-in sheet, registered the way the Account surface will. */
export function DemoSignInSheet({ open, onClose }: SheetComponentProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Sign in to Quilltip">
      <p>Passkey first. This is a stand-in for the fixture.</p>
    </Sheet>
  )
}
