import { describe, expect, it } from 'vitest'
import type { ActivityRowProps } from '@/system/components/ActivityRow'

const base = {
  lead: null,
  name: 'Tomás Reyes',
  amount: { cents: 300, display: '$3.00' },
  direction: 'out',
  status: 'done',
  time: '9:38',
} as const

describe('an activity row', () => {
  it('navigates, acts, or neither', () => {
    const link: ActivityRowProps = { ...base, href: '/receipt/1' }
    const button: ActivityRowProps = { ...base, onPress: () => {} }
    const plain: ActivityRowProps = { ...base }
    expect([link, button, plain]).toHaveLength(3)
  })

  it('is never a link and a button at once (checked by the typecheck)', () => {
    // @ts-expect-error A row cannot take both href and onPress.
    const both: ActivityRowProps = { ...base, href: '/r', onPress: () => {} }
    expect(both).toBeTruthy()
  })
})
