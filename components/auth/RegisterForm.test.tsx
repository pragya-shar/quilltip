/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterForm from '@/components/auth/RegisterForm'

const mockSignIn = vi.hoisted(() => vi.fn())
const mockReplace = vi.hoisted(() => vi.fn())
const mockUseAuthReturnPath = vi.hoisted(() => vi.fn())

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({
    signIn: mockSignIn,
    signOut: vi.fn(),
    user: null,
    isLoading: false,
    isAuthenticated: false,
  }),
}))

vi.mock('@/components/auth/useAuthReturnPath', () => ({
  useAuthReturnPath: () => mockUseAuthReturnPath(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

describe('RegisterForm accessibility', () => {
  beforeEach(() => {
    mockSignIn.mockReset()
    mockReplace.mockReset()
    mockUseAuthReturnPath.mockReset()
    mockUseAuthReturnPath.mockReturnValue('/profile?tab=wallet')
  })

  it('marks the first invalid field and associates its error on empty submit', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RegisterForm />)

    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(document.getElementById('email-error')).toHaveTextContent(
        'Email is required'
      )
    })

    const emailInput = screen.getByLabelText(/email address/i)
    expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    expect(emailInput).toHaveAttribute('aria-describedby', 'email-error')

    const emailError = document.getElementById('email-error')
    expect(emailError).toHaveTextContent('Email is required')

    expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent(
      'Email is required'
    )
  })

  it('clears email invalid state after the user enters a valid email', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RegisterForm />)

    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(document.getElementById('email-error')).toHaveTextContent(
        'Email is required'
      )
    })

    const emailInput = screen.getByLabelText(/email address/i)
    await user.type(emailInput, 'user@example.com')

    await waitFor(() => {
      expect(emailInput).toHaveAttribute('aria-invalid', 'false')
      expect(emailInput).not.toHaveAttribute('aria-describedby')
    })

    expect(document.getElementById('email-error')).toBeNull()
  })

  it(
    'shows a server email conflict on the email field',
    { timeout: 10_000 },
    async () => {
      const user = userEvent.setup({ delay: null })
      mockSignIn.mockRejectedValue(new Error('Account already exists'))

      render(<RegisterForm />)

      await user.type(
        screen.getByLabelText(/email address/i),
        'user@example.com'
      )
      await user.type(screen.getByLabelText(/^username$/i), 'myuser')
      await user.type(screen.getByLabelText(/^password$/i), 'Password1')
      await user.type(screen.getByLabelText(/^confirm password$/i), 'Password1')
      await user.click(screen.getByRole('button', { name: /create account/i }))

      await waitFor(() => {
        expect(document.getElementById('email-error')).toHaveTextContent(
          /an account with this email already exists/i
        )
      })

      const emailInput = screen.getByLabelText(/email address/i)
      expect(emailInput).toHaveAttribute('aria-invalid', 'true')
      expect(emailInput).toHaveAttribute('aria-describedby', 'email-error')
      expect(screen.queryByText(/registration failed/i)).not.toBeInTheDocument()
    }
  )

  it('redirects to the return path after successful registration', async () => {
    const user = userEvent.setup({ delay: null })
    mockSignIn.mockResolvedValue(undefined)

    render(<RegisterForm />)

    await user.type(screen.getByLabelText(/email address/i), 'user@example.com')
    await user.type(screen.getByLabelText(/^username$/i), 'myuser')
    await user.type(screen.getByLabelText(/^password$/i), 'Password1')
    await user.type(screen.getByLabelText(/^confirm password$/i), 'Password1')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/profile?tab=wallet')
    })
  })

  it('password visibility toggle has accessible name and pressed state', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RegisterForm />)

    const toggle = screen.getByRole('button', { name: /show password/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)

    expect(
      screen.getByRole('button', { name: /hide password/i })
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows password requirements before submit', () => {
    render(<RegisterForm />)

    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(screen.getByText(/one uppercase letter/i)).toBeInTheDocument()
    expect(screen.getByText(/one lowercase letter/i)).toBeInTheDocument()
    expect(screen.getByText(/one number/i)).toBeInTheDocument()
  })

  it('updates password requirements as the user types', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RegisterForm />)

    const passwordInput = screen.getByLabelText(/^password$/i)
    await user.type(passwordInput, 'Password1')

    const requirements = document.getElementById('password-requirements')
    expect(requirements).toBeInTheDocument()
    const items = requirements?.querySelectorAll('li') ?? []
    expect(items).toHaveLength(4)
    items.forEach((item) => {
      expect(item).toHaveClass('text-success-foreground')
    })
  })

  it('highlights unmet password rules on failed submit', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RegisterForm />)

    await user.type(screen.getByLabelText(/email address/i), 'user@example.com')
    await user.type(screen.getByLabelText(/^username$/i), 'myuser')
    await user.type(screen.getByLabelText(/^password$/i), 'weak')
    await user.type(screen.getByLabelText(/^confirm password$/i), 'weak')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(document.getElementById('password-error')).toHaveTextContent(
        'Password does not meet all requirements'
      )
    })

    const requirements = document.getElementById('password-requirements')
    const unmetItems = requirements?.querySelectorAll('.text-destructive') ?? []
    expect(unmetItems.length).toBeGreaterThan(0)
  })

  it(
    'clears password failure highlight when all rules are met',
    { timeout: 10_000 },
    async () => {
      const user = userEvent.setup({ delay: null })
      render(<RegisterForm />)

      await user.type(
        screen.getByLabelText(/email address/i),
        'user@example.com'
      )
      await user.type(screen.getByLabelText(/^username$/i), 'myuser')
      await user.type(screen.getByLabelText(/^password$/i), 'weak')
      await user.type(screen.getByLabelText(/^confirm password$/i), 'weak')
      await user.click(screen.getByRole('button', { name: /create account/i }))

      await waitFor(() => {
        expect(document.getElementById('password-error')).toBeInTheDocument()
      })

      const passwordInput = screen.getByLabelText(/^password$/i)
      await user.clear(passwordInput)
      await user.type(passwordInput, 'Password1')

      await waitFor(() => {
        const requirements = document.getElementById('password-requirements')
        const unmetItems =
          requirements?.querySelectorAll('.text-destructive') ?? []
        expect(unmetItems).toHaveLength(0)
      })
    }
  )

  it('confirm password visibility toggle has accessible name and pressed state', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RegisterForm />)

    const toggle = screen.getByRole('button', {
      name: /show confirm password/i,
    })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)

    expect(
      screen.getByRole('button', { name: /hide confirm password/i })
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
