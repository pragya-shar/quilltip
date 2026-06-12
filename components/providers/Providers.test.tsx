/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Providers from '@/components/providers/Providers'
import { useWalletActivation } from '@/components/providers/WalletActivationContext'

vi.mock('@convex-dev/auth/react', () => ({
  ConvexAuthProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('convex/react', () => ({
  ConvexReactClient: vi.fn(),
}))

vi.mock('@/components/theme/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/components/error/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => null,
}))

vi.mock('next/dynamic', () => ({
  default: () => {
    function DynamicWalletProvider({ children }: { children?: ReactNode }) {
      return <div data-testid="lazy-wallet-provider">{children}</div>
    }

    return DynamicWalletProvider
  },
}))

function WalletActivationButton() {
  const { activateWallet } = useWalletActivation()

  return (
    <button type="button" onClick={activateWallet}>
      Activate wallet
    </button>
  )
}

function StatefulChild() {
  const [value, setValue] = useState('')

  return (
    <input
      aria-label="Stateful child value"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  )
}

describe('Providers wallet activation', () => {
  it('preserves child component state when the wallet subsystem activates', async () => {
    const user = userEvent.setup({ delay: null })

    render(
      <Providers>
        <WalletActivationButton />
        <StatefulChild />
      </Providers>
    )

    const input = screen.getByRole('textbox', {
      name: 'Stateful child value',
    })

    await user.type(input, 'kept')
    await user.click(screen.getByRole('button', { name: 'Activate wallet' }))

    expect(
      screen.getByRole('textbox', {
        name: 'Stateful child value',
      })
    ).toHaveValue('kept')
  })
})
