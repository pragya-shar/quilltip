/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterForm from './RegisterForm'
const { signIn, replace } = vi.hoisted(() => ({
  signIn: vi.fn(),
  replace: vi.fn(),
}))
vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({ signIn }),
}))
vi.mock('./useAuthReturnPath', () => ({ useAuthReturnPath: () => '/library' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/lib/tip/pendingTipIntent', () => ({
  readPendingTipIntent: () => null,
}))
async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  password = 'Password1'
) {
  await user.type(screen.getByLabelText('Your name'), 'Alex Reader')
  await user.type(screen.getByLabelText('Email'), 'alex@example.com')
  await user.type(screen.getByLabelText('Password'), password)
}
describe('prototype registration with real auth', () => {
  beforeEach(() => {
    signIn.mockReset()
    replace.mockReset()
    signIn.mockResolvedValue({ signingIn: true })
  })
  it('creates an account from the three prototype fields and returns to the library', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RegisterForm />)
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/library'))
    expect(signIn).toHaveBeenCalledWith(
      'password',
      expect.objectContaining({
        name: 'Alex Reader',
        email: 'alex@example.com',
        password: 'Password1',
        flow: 'signUp',
        username: expect.stringMatching(/^[a-z][a-z0-9]{19}$/),
      })
    )
    expect(screen.getByRole('status')).toHaveTextContent(/account created/i)
  })
  it('focuses the first invalid field and associates its error', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RegisterForm />)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    const name = screen.getByLabelText('Your name')
    await waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(
      document.getElementById(name.getAttribute('aria-describedby')!)
    ).toHaveTextContent(/name/i)
    expect(signIn).not.toHaveBeenCalled()
    await user.type(name, 'Alex')
    expect(name).toHaveAttribute('aria-invalid', 'false')
  })
  it('keeps password policy and visibility usable in the single password field', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RegisterForm />)
    await fillForm(user, 'weak')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Password')).toHaveAttribute(
        'aria-invalid',
        'true'
      )
    )
    expect(signIn).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
    expect(
      screen.getByRole('button', { name: 'Hide password' })
    ).toHaveAttribute('aria-pressed', 'true')
  })
  it('retains details on conflict and permits retry without changing the generated handle', async () => {
    const user = userEvent.setup({ delay: null })
    signIn.mockRejectedValueOnce(new Error('Account already exists'))
    render(<RegisterForm />)
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveFocus())
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect(screen.getByLabelText('Your name')).toHaveValue('Alex Reader')
    expect(replace).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'another@example.com')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/library'))
    expect(signIn.mock.calls[1]![1].username).toBe(
      signIn.mock.calls[0]![1].username
    )
  })
  it('prevents another submission while account creation is pending', async () => {
    const user = userEvent.setup({ delay: null })
    signIn.mockReturnValue(new Promise(() => {}))
    render(<RegisterForm />)
    await fillForm(user)
    await user.dblClick(screen.getByRole('button', { name: 'Create account' }))
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'One moment…' })).toBeDisabled()
  })
})
