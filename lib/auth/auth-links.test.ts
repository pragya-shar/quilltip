import { describe, expect, it } from 'vitest'
import { REGISTER_FOR_WRITE_HREF } from '@/lib/auth/auth-links'

describe('auth-links', () => {
  it('builds register href that returns to the editor', () => {
    expect(REGISTER_FOR_WRITE_HREF).toBe('/register?returnTo=%2Fwrite')
  })
})
