/**
 * The passage identity vectors, for any test that checks the sentence rule
 * and ids: the Convex tests here and the browser suites, which run them in
 * real engines (Chromium, WebKit). Each case carries a `note` saying what the
 * rule does, including where it is knowingly crude.
 */
import identityV1 from './identity-v1.json'

export type IdentityVectors = typeof identityV1

export const identityVectors: IdentityVectors = identityV1
