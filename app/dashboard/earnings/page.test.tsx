/** @vitest-environment jsdom */
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardEarningsPage from './page'

const { replaceMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('NEXT_REDIRECT')
  },
  useRouter: () => ({ replace: replaceMock }),
}))

describe('DashboardEarningsPage', () => {
  beforeEach(() => {
    replaceMock.mockReset()
  })

  it('replaces the legacy route after render without throwing a server redirect', async () => {
    render(<DashboardEarningsPage />)

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/dashboard/stats')
    })
  })
})
