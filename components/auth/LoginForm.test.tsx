/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import LoginForm from './LoginForm'

const replace = vi.fn()
const signIn = vi.fn()
const searchParamsGet = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => ({
    get: (key: string) => searchParamsGet(key),
  }),
}))

vi.mock('@convex-dev/auth/react', () => ({
  useAuthActions: () => ({ signIn }),
}))

describe('LoginForm', () => {
  beforeEach(() => {
    replace.mockClear()
    signIn.mockReset()
    searchParamsGet.mockReset()
    signIn.mockResolvedValue(undefined)
    searchParamsGet.mockReturnValue(null)
  })

  it('redirects to home after sign-in when no redirect param', async () => {
    const user = userEvent.setup()
    render(<LoginForm />)

    await user.type(screen.getByLabelText(/email address/i), 'you@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(signIn).toHaveBeenCalled()
      expect(replace).toHaveBeenCalledWith('/')
    })
  })

  it('redirects to safe redirect path after sign-in', async () => {
    searchParamsGet.mockImplementation((key: string) =>
      key === 'redirect' ? '/profile?tab=wallet' : null
    )
    const user = userEvent.setup()
    render(<LoginForm />)

    await user.type(screen.getByLabelText(/email address/i), 'you@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/profile?tab=wallet')
    })
  })

  it('ignores unsafe redirect paths', async () => {
    searchParamsGet.mockImplementation((key: string) =>
      key === 'redirect' ? 'https://evil.com' : null
    )
    const user = userEvent.setup()
    render(<LoginForm />)

    await user.type(screen.getByLabelText(/email address/i), 'you@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/')
    })
  })
})
