/** @vitest-environment jsdom */
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ProfileHubPage from './page'
import {
  WALLET_PROFILE_HUB_PATH,
  getLoginRedirectPath,
  getWalletTabPath,
} from '@/lib/navigation/walletProfileDestination'

const replace = vi.fn()
const useAuthMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
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

describe('ProfileHubPage', () => {
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

    render(<ProfileHubPage />)

    expect(replace).not.toHaveBeenCalled()
  })

  it('redirects authenticated users to their wallet tab', async () => {
    useAuthMock.mockReturnValue({
      user: { username: 'alice' },
      isAuthenticated: true,
      isLoading: false,
    })

    render(<ProfileHubPage />)

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

    render(<ProfileHubPage />)

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        getLoginRedirectPath(WALLET_PROFILE_HUB_PATH)
      )
    })
  })
})
