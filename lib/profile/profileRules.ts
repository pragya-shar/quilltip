/** Limits shared by the profile forms and the backend that enforces them. */
export const PROFILE_NAME_MAX_LENGTH = 50
export const PROFILE_BIO_MAX_LENGTH = 500

/** Returns a message to show the writer, or null when the name is allowed. */
export function profileNameError(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Enter the name readers will see.'
  if (trimmed.length > PROFILE_NAME_MAX_LENGTH) {
    return `Display name can be up to ${PROFILE_NAME_MAX_LENGTH} characters.`
  }
  return null
}

/** Returns a message to show the writer, or null when the bio is allowed. */
export function profileBioError(bio: string): string | null {
  if (bio.trim().length > PROFILE_BIO_MAX_LENGTH) {
    return `Bio can be up to ${PROFILE_BIO_MAX_LENGTH} characters.`
  }
  return null
}
