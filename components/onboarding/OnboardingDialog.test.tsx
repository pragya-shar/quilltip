/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { OnboardingDialog } from '@/components/onboarding/OnboardingDialog'

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

describe('OnboardingDialog', () => {
  beforeEach(() => {
    mockCompleteOnboarding.mockReset()
    mockPush.mockReset()
    vi.mocked(toast.error).mockClear()
    mockCompleteOnboarding.mockResolvedValue(undefined)
  })

  it('shows step progress on first step', () => {
    render(<OnboardingDialog />)

    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Step 1 of 3' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Next/i })).toBeInTheDocument()
  })

  it('advances step progress when Next is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OnboardingDialog />)

    await user.click(screen.getByRole('button', { name: /^Next/i }))

    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Set Up Now/i })
    ).toBeInTheDocument()
  })

  it('calls completeOnboarding when Skip is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OnboardingDialog />)

    await user.click(screen.getByRole('button', { name: /Skip onboarding/i }))

    await waitFor(() => {
      expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1)
    })
  })

  it('calls completeOnboarding when close button is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OnboardingDialog />)

    await user.click(screen.getByRole('button', { name: /Close onboarding/i }))

    await waitFor(() => {
      expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1)
    })
  })

  it('shows Get Started on final step and completes onboarding', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OnboardingDialog />)

    await user.click(screen.getByRole('button', { name: /^Next/i }))
    await user.click(
      screen.getByRole('button', { name: /I'll do this later/i })
    )
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Get Started/i }))

    await waitFor(() => {
      expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1)
    })
  })

  it('navigates after completing via shortcut on final step', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OnboardingDialog />)

    await user.click(screen.getByRole('button', { name: /^Next/i }))
    await user.click(
      screen.getByRole('button', { name: /I'll do this later/i })
    )
    await user.click(screen.getByRole('button', { name: /^Read$/i }))

    await waitFor(() => {
      expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1)
      expect(mockPush).toHaveBeenCalledWith('/articles')
    })
  })

  it('shows error toast when completeOnboarding fails', async () => {
    const user = userEvent.setup({ delay: null })
    mockCompleteOnboarding.mockRejectedValue(new Error('Network error'))
    render(<OnboardingDialog />)

    await user.click(screen.getByRole('button', { name: /Skip onboarding/i }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Could not save your progress. Please try again.'
      )
    })
    expect(
      screen.getByRole('button', { name: /Skip onboarding/i })
    ).toBeInTheDocument()
  })

  it('renders a modal dialog', () => {
    render(<OnboardingDialog />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
