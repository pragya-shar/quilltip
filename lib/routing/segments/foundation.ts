/**
 * The shell's own segments, and the structure's paths, reserved before their
 * pages ship so no writer can take them as a handle.
 */
export const segments: readonly string[] = [
  'pocket',
  'shelf',
  'system',
  // Reserved before they ship.
  'lines',
  'search',
  'signin',
  'today',
  'you',
]
