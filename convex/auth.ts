import { Password } from '@convex-dev/auth/providers/Password'
import { convexAuth } from '@convex-dev/auth/server'

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      // Profile mapping for user creation
      profile(params) {
        const now = Date.now()
        const handle = `q${crypto.randomUUID().replaceAll('-', '').slice(0, 19)}`
        return {
          email: params.email as string,
          name: params.name as string,
          // Generated here, not taken from the request, so signup cannot claim
          // a handle that belongs to someone (including an earlier handle).
          // Writers choose their own handle later from their profile.
          username: handle,
          usernameLower: handle.toLowerCase(),
          createdAt: now,
          updatedAt: now,
        }
      },
      // Email verification disabled for POC - can add later with Resend
      // Password reset disabled for POC - can add later with Resend
    }),
  ],
})
