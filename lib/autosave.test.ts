import { describe, expect, it } from 'vitest'
import { AUTO_SAVE_DEBOUNCE_SECONDS, AUTO_SAVE_GUIDANCE } from './autosave'

describe('autosave copy', () => {
  it('guidance includes debounce seconds from AUTO_SAVE_DEBOUNCE_MS', () => {
    expect(AUTO_SAVE_GUIDANCE).toContain(String(AUTO_SAVE_DEBOUNCE_SECONDS))
  })
})
