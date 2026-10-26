// Only the Convex boundary is replaced; the editor and Radix focus scopes are real.
export const api = {
  users: { updateProfile: 'updateProfile', clearAvatar: 'clearAvatar' },
  wikimedia: { resolveWikimediaFileUrl: 'resolveWikimediaFileUrl' },
}
export const useConvex = () => ({})
export const useAction = () => async () => ({ kind: 'not_file_page' })
export const useMutation = () => async (args: { avatar: string }) => {
  const response = await fetch('/save', {
    method: 'POST',
    body: JSON.stringify(args),
  })
  if (!response.ok) throw new Error('Could not save image URL')
  window.dispatchEvent(new CustomEvent('avatar-saved', { detail: args.avatar }))
}
