import { Button } from '../../../system/components/Button'
import { Sheet } from '../../../system/components/Sheet'
import { TextField } from '../../../system/components/TextField'
import type { SheetComponentProps } from '../../../shell/sheetRegistry'

/** A stand-in sign-in sheet, registered the way the Account surface will:
 * two fields and two actions, so the keyboard checks have a real form. */
export function DemoSignInSheet({ open, onClose }: SheetComponentProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Sign in to Quilltip"
      actions={
        <>
          <Button variant="primary" size="l" block onClick={onClose}>
            Sign in
          </Button>
          <Button variant="quiet" block onClick={onClose}>
            Create an account
          </Button>
        </>
      }
    >
      <p>Passkey first. This is a stand-in for the fixture.</p>
      <TextField label="Email" type="email" autoComplete="email" />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
      />
    </Sheet>
  )
}
