import { describe, expect, it } from 'vitest'
import { Button, type ButtonProps } from '@/system/components/Button'
import {
  IconButton,
  type IconButtonProps,
} from '@/system/components/IconButton'
import { ShareIcon } from '@/system/icons'

// Checked by the type check: a link form never takes `unavailable`, since
// a link would still go where it points.
const button: ButtonProps = { children: 'Add', unavailable: 'Not yet' }
const iconButton: IconButtonProps = {
  icon: ShareIcon,
  label: 'Share',
  unavailable: true,
}
// @ts-expect-error a link cannot be unavailable
const link: ButtonProps = { children: 'Add', href: '/x', unavailable: true }
// @ts-expect-error a link cannot be unavailable
const iconLink: IconButtonProps = {
  icon: ShareIcon,
  label: 'Share',
  href: '/x',
  unavailable: true,
}

describe('unavailable', () => {
  it('is a button state only', () => {
    expect([Button, IconButton].every((c) => typeof c === 'function')).toBe(
      true
    )
    expect([button, iconButton, link, iconLink]).toHaveLength(4)
  })
})
