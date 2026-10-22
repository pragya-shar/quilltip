import { expect, it, vi } from 'vitest'
const redirect = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ redirect }))
import DraftsPage from './page'
it('opens the prototype writing drawer from the existing drafts route', () => {
  DraftsPage()
  expect(redirect).toHaveBeenCalledWith('/write?desk=writing')
})
