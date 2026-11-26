import { describe, expectTypeOf, it } from 'vitest'

import type { Id } from '../../convex/_generated/dataModel'
import type {
  PreparedTabTip as ConvexPreparedTabTip,
  SubmittedTabTip as ConvexSubmittedTabTip,
} from '../../convex/lib/chain/tabLedger'
import type { PreparedTabTip, SubmittedTabTip } from '../../lib/stellar/v2/tab'

type PrepareId = Id<'tips'> | Id<'highlightTips'>

// The client mirrors the Convex result types so it does not import Convex.
// These checks fail `tsc` when the two drift apart.
describe('client types match Convex', () => {
  it('accepts a tabs.prepareTip result', () => {
    expectTypeOf<ConvexPreparedTabTip>().toExtend<PreparedTabTip<PrepareId>>()
  })

  it('accepts a tabs.submitTip result', () => {
    expectTypeOf<ConvexSubmittedTabTip>().toExtend<SubmittedTabTip>()
  })
})
