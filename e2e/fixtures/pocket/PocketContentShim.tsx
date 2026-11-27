import { Pocket } from '../../../components/pocket/Pocket'

// Stands in for shell/pocket/PocketContent until the shell lets the Pocket
// surface supply the sheet's and the panel's content (asked of the
// foundation): the fixture resolves that import here.
export function PocketContent() {
  return <Pocket />
}
