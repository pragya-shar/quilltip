import { Password } from '@convex-dev/auth/providers/Password'
import { convexAuth } from '@convex-dev/auth/server'

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      // Profile mapping for user creation
      profile(params) {
        const now = Date.now()
        return {
          email: params.email as string,
          name: params.name as string,
          username: params.username as string,
          usernameLower: (params.username as string).toLowerCase(),
          createdAt: now,
          updatedAt: now,
        }
      },
      // Email verification disabled for POC - can add later with Resend
      // Password reset disabled for POC - can add later with Resend
    }),
  ],
})
