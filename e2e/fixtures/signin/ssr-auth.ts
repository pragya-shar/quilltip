// The two auth imports as the server renders /signin: nothing is known yet.
export const useConvexAuth = () => ({ isLoading: true, isAuthenticated: false })
export const useAuthActions = () => ({
  signIn: async () => ({ signingIn: false }),
  signOut: async () => {},
})
