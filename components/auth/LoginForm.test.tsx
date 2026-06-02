/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginForm from '@/components/auth/LoginForm'

const mockSignIn = vi.hoisted(() => vi.fn())
const mockReplace = vi.hoisted(() => vi.fn())
const mockUseAuthReturnPath = vi.hoisted(() => vi.fn())
const mockSearchParamsGet = vi.hoisted(() => vi.fn())

vi.mock('@convex-dev/auth/react', () => ({
  useAuthActions: () => ({
    signIn: mockSignIn,
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParamsGet(key),
  }),
}))

vi.mock('@/components/auth/useAuthReturnPath', () => ({
  useAuthReturnPath: () => mockUseAuthReturnPath(),
}))

vi.mock('@/lib/tip/pendingTipIntent', () => ({
  readPendingTipIntent: () => null,
}))

describe('LoginForm', () => {
  beforeEach(() => {
    mockSignIn.mockReset()
    mockReplace.mockReset()
    mockUseAuthReturnPath.mockReset()
    mockSearchParamsGet.mockReset()
    mockUseAuthReturnPath.mockReturnValue('/articles?tag=writing')
    mockSearchParamsGet.mockReturnValue(null)
    mockSignIn.mockResolvedValue(undefined)
  })

  it('shows redirecting message and navigates to the return path on successful sign in', async () => {
    const user = userEvent.setup({ delay: null })

    render(<LoginForm />)

    await user.type(screen.getByLabelText(/email address/i), 'user@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/signed in successfully! redirecting to dashboard/i)
      ).toBeInTheDocument()
    })

    expect(mockSignIn).toHaveBeenCalledWith('password', {
      email: 'user@example.com',
      password: 'password123',
      flow: 'signIn',
    })
    expect(mockReplace).toHaveBeenCalledWith('/articles?tag=writing')
    expect(
      screen.queryByRole('button', { name: /signing in/i })
    ).not.toBeInTheDocument()
  })

  it('redirects to safe redirect query param when present', async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === 'redirect' ? '/profile?tab=wallet' : null
    )
    const user = userEvent.setup({ delay: null })

    render(<LoginForm />)

    await user.type(screen.getByLabelText(/email address/i), 'you@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/profile?tab=wallet')
    })
  })

  it('ignores unsafe redirect query params', async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === 'redirect' ? 'https://evil.com' : null
    )
    const user = userEvent.setup({ delay: null })

    render(<LoginForm />)

    await user.type(screen.getByLabelText(/email address/i), 'you@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/articles?tag=writing')
    })
  })

  it('restores an editable form with retry after failed sign in', async () => {
    const user = userEvent.setup({ delay: null })
    mockSignIn.mockRejectedValue(new Error('Invalid credentials'))

    render(<LoginForm />)

    await user.type(screen.getByLabelText(/email address/i), 'user@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument()
    })

    const submitButton = screen.getByRole('button', { name: /sign in/i })
    expect(submitButton).toBeEnabled()
    expect(mockReplace).not.toHaveBeenCalled()

    const emailInput = screen.getByLabelText(/email address/i)
    const passwordInput = screen.getByLabelText(/^password$/i)
    expect(emailInput).not.toBeDisabled()
    expect(passwordInput).not.toBeDisabled()

    await user.clear(passwordInput)
    await user.type(passwordInput, 'new-attempt')
    expect(passwordInput).toHaveValue('new-attempt')
  })

  it('password visibility toggle has accessible name and pressed state', async () => {
    const user = userEvent.setup({ delay: null })
    render(<LoginForm />)

    const toggle = screen.getByRole('button', { name: /show password/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)

    expect(
      screen.getByRole('button', { name: /hide password/i })
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
