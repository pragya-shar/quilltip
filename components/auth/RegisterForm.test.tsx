/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterForm from '@/components/auth/RegisterForm'

const mockSignIn = vi.hoisted(() => vi.fn())
const mockReplace = vi.hoisted(() => vi.fn())

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({
    signIn: mockSignIn,
    signOut: vi.fn(),
    user: null,
    isLoading: false,
    isAuthenticated: false,
  }),
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

  it('shows a server email conflict on the email field', async () => {
    const user = userEvent.setup({ delay: null })
    mockSignIn.mockRejectedValue(new Error('Account already exists'))

    render(<RegisterForm />)

    await user.type(screen.getByLabelText(/email address/i), 'user@example.com')
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
