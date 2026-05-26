/** @vitest-environment jsdom */
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ProfileRedirectPage from './page'
import { buildLoginHref } from '@/lib/auth/safeReturnPath'
import {
  WALLET_PROFILE_HUB_PATH,
  getWalletTabPath,
} from '@/lib/navigation/walletProfileDestination'

const replace = vi.fn()
const useAuthMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/profile',
  useSearchParams: () => new URLSearchParams('tab=wallet'),
}))

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock('@/components/layout/AppNavigation', () => ({
  default: () => <nav aria-label="App navigation" />,
}))

vi.mock('@/components/profile/ProfilePageLoadingSkeleton', () => ({
  ProfilePageLoadingSkeleton: () => <div data-testid="profile-skeleton" />,
}))

describe('ProfileRedirectPage', () => {
  beforeEach(() => {
    replace.mockClear()
    useAuthMock.mockReset()
  })

  it('does not redirect while auth is loading', () => {
    useAuthMock.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    })

    render(<ProfileRedirectPage />)

    expect(replace).not.toHaveBeenCalled()
  })

  it('redirects authenticated users to their wallet tab', async () => {
    useAuthMock.mockReturnValue({
      user: { username: 'alice' },
      isAuthenticated: true,
      isLoading: false,
    })

    render(<ProfileRedirectPage />)

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(getWalletTabPath('alice'))
    })
  })

  it('redirects signed-out users to login with hub path preserved', async () => {
    useAuthMock.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    })

    render(<ProfileRedirectPage />)

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        buildLoginHref(WALLET_PROFILE_HUB_PATH)
      )
    })
  })
})
