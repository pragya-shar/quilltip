/** @vitest-environment jsdom */
import { useRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, beforeEach } from 'vitest'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

function TestSheet() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button type="button">Behind</button>
      <Sheet open={open} onOpenChange={setOpen}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
        >
          Open menu
        </button>
        <SheetContent
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            triggerRef.current?.focus()
          }}
        >
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <button type="button">Inside action</button>
          <p>Menu content</p>
        </SheetContent>
      </Sheet>
    </>
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

  it('keeps focus inside the dialog when tabbing', async () => {
    const user = userEvent.setup()
    render(<TestSheet />)

    const behind = screen.getByRole('button', { name: 'Behind' })

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    const dialog = screen.getByRole('dialog')

    for (let i = 0; i < 12; i++) {
      await user.tab()
      expect(behind).not.toHaveFocus()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('returns focus to the trigger when closed with Escape', async () => {
    const user = userEvent.setup()
    render(<TestSheet />)

    const trigger = screen.getByRole('button', { name: 'Open menu' })

    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
