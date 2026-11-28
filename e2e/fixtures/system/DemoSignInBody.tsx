import { Button } from '../../../system/components/Button'
import { TextField } from '../../../system/components/TextField'
import type { SheetBodyProps } from '../../../shell/sheets/types'

/** The stand-in sign-in sheet's body (declared in ./demoSignIn.ts): two
 * fields, and the two buttons in the body under the password, kept in view
 * with it above a keyboard (`data-sheet-keep`), as the real sheet has them.
 * No backend. */
export default function DemoSignInBody({ close }: SheetBodyProps) {
  return (
    <>
      <p>Passkey first. This is a stand-in for the fixture.</p>
      <TextField label="Email" type="email" autoComplete="email" />
      <div data-sheet-keep="">
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
        />
        <Button variant="primary" size="l" block onClick={close}>
          Sign in
        </Button>
        <Button variant="quiet" block onClick={close}>
          Create an account
        </Button>
      </div>
      <p>Terms. Forgot your password?</p>
    </>
  )
}
