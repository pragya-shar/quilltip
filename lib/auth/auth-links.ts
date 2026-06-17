import { buildRegisterHref } from '@/lib/auth/safeReturnPath'

/** Register URL that returns the user to the editor after signup. */
export const REGISTER_FOR_WRITE_HREF = buildRegisterHref('/write')
