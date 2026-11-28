// The two auth imports as the server renders /signin: nothing is known yet.
export const useConvexAuth = () => ({ isLoading: true, isAuthenticated: false })
export const useAuthActions = () => ({
  signIn: async () => ({ signingIn: false }),
  signOut: async () => {},
})

// What the shell's balance asks for on the server: no client, no answers.
export const useConvex = () => null
export const useQuery = () => undefined
export const usePaginatedQuery = () => ({
  results: [],
  status: 'Exhausted',
  isLoading: false,
  loadMore() {},
})
export const useMutation = () => async () => undefined
export const useAction = () => async () => undefined
