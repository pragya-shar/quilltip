/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('test throw')
  }
  return <div>ok</div>
}

describe('ErrorBoundary', () => {
  it('renders static fallback and logs when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary fallback={<p>section failed</p>}>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    )

    expect(screen.getByText('section failed')).toBeInTheDocument()
    expect(spy).toHaveBeenCalled()
    const calls = spy.mock.calls.map((c) => c.join(' '))
    expect(calls.some((line) => line.includes('ErrorBoundary caught:'))).toBe(
      true
    )

    spy.mockRestore()
  })

  it('renders function fallback with reset that recovers', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()

    function Harness() {
      const [fail, setFail] = useState(true)
      return (
        <ErrorBoundary
          fallback={({ reset }) => (
            <div>
              <p>custom fallback</p>
              <button
                type="button"
                onClick={() => {
                  setFail(false)
                  reset()
                }}
              >
                Try again
              </button>
            </div>
          )}
        >
          <ThrowingChild shouldThrow={fail} />
        </ErrorBoundary>
      )
    }

    render(<Harness />)

    expect(screen.getByText('custom fallback')).toBeInTheDocument()
    expect(spy).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(screen.getByText('ok')).toBeInTheDocument()

    spy.mockRestore()
  })
})
