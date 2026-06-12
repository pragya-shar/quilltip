/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { OnboardingIntentHome } from '@/components/onboarding/OnboardingIntentHome'

const mockCompleteOnboarding = vi.hoisted(() => vi.fn())
const mockPush = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useMutation: () => mockCompleteOnboarding,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

describe('OnboardingIntentHome', () => {
  beforeEach(() => {
    mockCompleteOnboarding.mockReset()
    mockPush.mockReset()
    vi.mocked(toast.error).mockClear()
    mockCompleteOnboarding.mockResolvedValue(undefined)
  })

  it('shows intent cards and Continue on first render', () => {
    render(<OnboardingIntentHome />)

    expect(
      screen.getByRole('heading', { name: /Welcome to Quilltip/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /Read first/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /Write first/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /Set up wallet/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled()
    expect(screen.queryByText(/Step \d+ of \d+/)).not.toBeInTheDocument()
  })

  it('shows skip action', () => {
    render(<OnboardingIntentHome />)

    expect(
      screen.getByRole('button', { name: /Skip for now/i })
    ).toBeInTheDocument()
  })

  it('enables Continue after selecting an intent', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OnboardingIntentHome />)

    await user.click(screen.getByRole('radio', { name: /Read first/i }))

    expect(screen.getByRole('button', { name: /Continue/i })).toBeEnabled()
  })

  it('calls completeOnboarding when Skip for now is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OnboardingIntentHome />)

    await user.click(screen.getByRole('button', { name: /Skip for now/i }))

    await waitFor(() => {
      expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1)
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('navigates to articles when Read first is selected and Continue is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OnboardingIntentHome />)

    await user.click(screen.getByRole('radio', { name: /Read first/i }))
    await user.click(screen.getByRole('button', { name: /Continue/i }))

    await waitFor(() => {
      expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1)
      expect(mockPush).toHaveBeenCalledWith('/articles')
    })
  })

  it('navigates to write when Write first is selected and Continue is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OnboardingIntentHome />)

    await user.click(screen.getByRole('radio', { name: /Write first/i }))
    await user.click(screen.getByRole('button', { name: /Continue/i }))

    await waitFor(() => {
      expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1)
      expect(mockPush).toHaveBeenCalledWith('/write')
    })
  })

  it('navigates to guide when Set up wallet is selected and Continue is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OnboardingIntentHome />)

    await user.click(screen.getByRole('radio', { name: /Set up wallet/i }))
    await user.click(screen.getByRole('button', { name: /Continue/i }))

    await waitFor(() => {
      expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1)
      expect(mockPush).toHaveBeenCalledWith('/guide')
    })
  })

  it('shows error toast when completeOnboarding fails', async () => {
    const user = userEvent.setup({ delay: null })
    mockCompleteOnboarding.mockRejectedValue(new Error('Network error'))
    render(<OnboardingIntentHome />)

    await user.click(screen.getByRole('button', { name: /Skip for now/i }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Could not save your progress. Please try again.'
      )
    })
    expect(
      screen.getByRole('button', { name: /Skip for now/i })
    ).toBeInTheDocument()
  })

  it('renders as a page section, not a dialog', () => {
    render(<OnboardingIntentHome />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Welcome to Quilltip/i })
    ).toBeInTheDocument()
  })
})
