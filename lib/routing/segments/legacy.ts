/**
 * First path segments of the legacy pages (app/(legacy)). A surface that
 * deletes one of them keeps it here until its redirect no longer needs it;
 * the reserved-segment test fails if a route is missing, not if a word stays.
 */
export const segments: readonly string[] = [
  'articles',
  'contact',
  'dashboard',
  'demo',
  'drafts',
  'forgot-password',
  'guide',
  'library',
  'login',
  'ops',
  'privacy',
  'profile',
  'register',
  'reset-password',
  'settings',
  'status',
  'support',
  'terms',
  'waitlist',
  'wallet',
  'welcome',
  'write',
]
