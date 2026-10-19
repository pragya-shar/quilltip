/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from '../../app/(auth)/login/page'
import RegisterPage from '../../app/(auth)/register/page'
const state = vi.hoisted(() => ({ query: '' }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.query),
  useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock('@convex-dev/auth/react', () => ({
  useAuthActions: () => ({ signIn: vi.fn() }),
}))
vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({ signIn: vi.fn() }),
}))
describe('auth screen navigation', () => {
  beforeEach(() => {
    state.query = 'next=%2Fmaya%2Fstory%3Fbookmark%3D1%23passage'
  })
  it('preserves the complete destination when switching from login to signup', async () => {
    render(<LoginPage />)
    expect(
      await screen.findByRole('link', { name: /^sign up$/i })
    ).toHaveAttribute(
      'href',
      '/register?returnTo=%2Fmaya%2Fstory%3Fbookmark%3D1%23passage'
    )
  })
  it('preserves wallet redirects when switching from signup to login', async () => {
    state.query = 'redirect=%2Fdashboard%2Fwallet'
    render(<RegisterPage />)
    expect(
      await screen.findByRole('link', { name: /^log in$/i })
    ).toHaveAttribute('href', '/login?returnTo=%2Fdashboard%2Fwallet')
  })
})
