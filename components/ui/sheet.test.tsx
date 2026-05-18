/** @vitest-environment jsdom */
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, beforeEach } from 'vitest'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

function TestSheet() {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button">Open menu</button>
      </SheetTrigger>
      <SheetContent>
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <p>Menu content</p>
      </SheetContent>
    </Sheet>
  )
}

describe('Sheet', () => {
  beforeEach(() => {
    document.body.style.pointerEvents = ''
  })

  it('closes on Escape when controlled', async () => {
    const user = userEvent.setup()
    render(<TestSheet />)

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
