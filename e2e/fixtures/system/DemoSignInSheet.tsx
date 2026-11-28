import { Button } from '../../../system/components/Button'
import { Sheet } from '../../../system/components/Sheet'
import { TextField } from '../../../system/components/TextField'
import type { SheetComponentProps } from '../../../shell/sheetRegistry'

/** A stand-in sign-in sheet, registered the way the Account surface will:
 * two fields, and the two buttons in the body under the password, as a
 * lazily loaded sheet has them, kept in view with it (`data-sheet-keep`). */
export function DemoSignInSheet({ open, onClose }: SheetComponentProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Sign in to Quilltip">
      <p>Passkey first. This is a stand-in for the fixture.</p>
      <TextField label="Email" type="email" autoComplete="email" />
      <div data-sheet-keep="">
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
        />
        <Button variant="primary" size="l" block onClick={onClose}>
          Sign in
        </Button>
        <Button variant="quiet" block onClick={onClose}>
          Create an account
        </Button>
      </div>
      <p>Terms. Forgot your password?</p>
    </Sheet>
  )
}
