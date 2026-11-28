import { registerAfterSignIn } from '../../../lib/auth/afterSignIn'

// `?after=notice,slow,fail`: steps registered to run after sign-in, as
// another package would register one (for example Write's drafts on this
// device). `notice` says one sentence; `slow` never finishes and is left
// behind at its 300 ms bound; `fail` throws. None may hold the reader.
const wanted = new Set(
  (new URLSearchParams(location.search).get('after') ?? '').split(',')
)
if (wanted.has('notice'))
  registerAfterSignIn({
    name: 'fixture notice',
    run: async () => 'Two drafts on this device are waiting in Write.',
  })
if (wanted.has('slow'))
  registerAfterSignIn({
    name: 'fixture slow',
    timeoutMs: 300,
    run: () => new Promise<string>(() => {}),
  })
if (wanted.has('fail'))
  registerAfterSignIn({
    name: 'fixture fail',
    run: async () => {
      throw new Error('offline')
    },
  })
