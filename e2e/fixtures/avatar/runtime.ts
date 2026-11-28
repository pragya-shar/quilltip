// Only the Convex boundary is replaced; the editor, the upload request and
// Radix focus scopes are real (#633: photos are uploaded, never pasted).
export const api = {
  users: { clearAvatar: 'clearAvatar' },
  uploadIngress: { issueTicket: 'issueTicket' },
  uploads: { updateUserAvatar: 'updateUserAvatar' },
}
export class ConvexReactClient {}

/** The upload ticket, then the saved photo's storage address. */
export const useConvex = () => ({
  action: async () => ({ url: '/upload', token: 'fixture-token' }),
  mutation: async () => {
    const avatarUrl = `${location.origin}/api/storage/uploaded.svg`
    window.dispatchEvent(new CustomEvent('avatar-saved', { detail: avatarUrl }))
    return { avatarUrl }
  },
})

/** Removing the photo. */
export const useMutation = () => async () => {
  const response = await fetch('/remove', { method: 'POST' })
  if (!response.ok) throw new Error('Could not remove profile photo')
  window.dispatchEvent(new CustomEvent('avatar-saved', { detail: '' }))
}
