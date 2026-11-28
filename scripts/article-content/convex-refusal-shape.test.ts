/// <reference types="vite/client" />
/**
 * The text a writer sees for a refusal from Convex, on the error the Convex
 * client really throws (#633).
 *
 * 1. convex-test runs the real function (`publishArticle`, `updateProfile`),
 *    which refuses with a `ConvexError`.
 * 2. Its data is encoded as the function runtime encodes it for the wire
 *    (`convexToJson`), and a stand-in deployment answers the app's own
 *    clients with it: `ConvexReactClient` (the WebSocket client behind
 *    `useMutation` and `lib/upload`) through a fake socket, and
 *    `ConvexHttpClient` through a fake fetch. The clients decode it with
 *    their own code (`jsonToConvex`, `forwardData`, and the
 *    `[CONVEX M(<function>)] … Called by client` wrapper).
 * 3. The test asserts the exact text the page shows.
 *
 * The deployment's message is sent in both forms: a development deployment
 * sends the request id, the error and its stack; a production deployment
 * redacts it to the request id and "Server Error". Only `errorData` carries
 * the refusal in both. No network and no backend: the socket and fetch are
 * in-process.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { convexTest } from 'convex-test'
import { ConvexHttpClient } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import { ConvexError, convexToJson, type Value } from 'convex/values'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import {
  PUBLISH_FAILED_DETAIL,
  publishErrorFeedback,
  publishFeedbackPlace,
} from '../../lib/editor/publish-feedback'
import { convexErrorMessage } from '../../lib/feedback/convexErrorMessage'
import {
  avatarSourceRefusal,
  imageSourceRefusal,
} from '../../lib/security/imageSources'
import { uploadAvatarFile, uploadFile } from '../../lib/upload'

const modules = import.meta.glob('../../convex/**/*.ts')

const OWN = 'https://own-deployment-123.convex.cloud'
const own = `${OWN}/api/storage/5c1e2f0a-uploaded`
const outside = 'https://outside-host.example/pictures/one.png'
const REQUEST_ID = '6a1f0c9e2b7d4e3a'

beforeEach(() => vi.stubEnv('CONVEX_CLOUD_URL', OWN))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** The real refusal: what the function threw, and its data on the wire. */
type Refusal = { error: ConvexError<Value>; errorData: unknown }

async function refusedBy(promise: Promise<unknown>): Promise<Refusal> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  const refusal = error as ConvexError<Value>
  // As the function runtime sends `data`: convexToJson, through JSON.
  return {
    error: refusal,
    errorData: JSON.parse(JSON.stringify(convexToJson(refusal.data))),
  }
}

async function setup() {
  const t = convexTest(schema, modules)
  const authorId = await t.run((ctx) =>
    ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'refusal-writer',
      name: 'Refusal Writer',
      stellarAddress: 'G' + 'A'.repeat(55),
      stellarAddressVerifiedAt: 1,
      stellarAddressVerifiedNetwork: 'Test SDF Network ; September 2015',
      createdAt: 1,
      updatedAt: 1,
    })
  )
  const writer = t.withIdentity({ subject: `${authorId}|session` })
  return { t, writer }
}

/** `publishArticle` refusing a draft with an image from another host. */
async function publishRefusal() {
  const { t, writer } = await setup()
  const id = await writer.mutation(api.articles.saveDraft, {
    title: 'Pictures of words',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Words to read.' }],
        },
        { type: 'resizableImage', attrs: { src: own } },
        { type: 'resizableImage', attrs: { src: outside } },
      ],
    },
  })
  await t.run((ctx) =>
    ctx.db.patch(id, { excerpt: 'A short piece about pictures of words.' })
  )
  return {
    id,
    refusal: await refusedBy(
      writer.mutation(api.articles.publishArticle, { id })
    ),
  }
}

type Deployment = 'development' | 'production'

/** The message a deployment sends with a failed function. */
function serverMessage(deployment: Deployment, error?: Error): string {
  const redacted = `[Request ID: ${REQUEST_ID}] Server Error`
  if (deployment === 'production' || !error) return redacted
  return `${redacted}\nUncaught ${error.stack ?? `${error.name}: ${error.message}`}`
}

/** A failure the deployment sends: its message and, for a ConvexError, data. */
type Failure = { errorMessage: string; errorData?: unknown }

/**
 * A WebSocket that answers every mutation and action with `failure`, for
 * `ConvexReactClient`'s `webSocketConstructor`. Other messages (connect,
 * query set, authentication) get no answer, which the client allows.
 */
function failingSocket(failure: Failure) {
  return class FailingSocket {
    onopen: (() => void) | null = null
    onmessage: ((message: { data: string }) => void) | null = null
    onclose: ((event: { code: number; reason: string }) => void) | null = null
    onerror: ((error: unknown) => void) | null = null
    constructor(readonly url: string) {
      setTimeout(() => this.onopen?.(), 0)
    }
    send(raw: string) {
      const message = JSON.parse(raw) as { type: string; requestId?: number }
      if (message.type !== 'Mutation' && message.type !== 'Action') return
      const response = {
        type:
          message.type === 'Mutation' ? 'MutationResponse' : 'ActionResponse',
        requestId: message.requestId,
        success: false,
        result: failure.errorMessage,
        logLines: [],
        ...(failure.errorData !== undefined
          ? { errorData: failure.errorData }
          : {}),
      }
      setTimeout(() => this.onmessage?.({ data: JSON.stringify(response) }), 0)
    }
    close() {
      setTimeout(() => this.onclose?.({ code: 1000, reason: '' }), 0)
    }
  }
}

function reactClient(failure: Failure) {
  return new ConvexReactClient(OWN, {
    webSocketConstructor: failingSocket(failure) as unknown as typeof WebSocket,
    unsavedChangesWarning: false,
    logger: false,
  })
}

/** What `ConvexHttpClient` receives for a failed function: status 560. */
function failingFetch(failure: Failure): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        status: 'error',
        errorMessage: failure.errorMessage,
        logLines: [],
        ...(failure.errorData !== undefined
          ? { errorData: failure.errorData }
          : {}),
      }),
      { status: 560, headers: { 'Content-Type': 'application/json' } }
    )
}

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the call to fail')
    },
    (e: unknown) => e
  )
}

const DEPLOYMENTS: Deployment[] = ['development', 'production']

test.each(DEPLOYMENTS)(
  'publish: the writer sees the refusal alone, from the WebSocket client, on a %s deployment',
  async (deployment) => {
    const { id, refusal } = await publishRefusal()
    const client = reactClient({
      errorMessage: serverMessage(deployment, refusal.error),
      errorData: refusal.errorData,
    })
    try {
      const error = await thrownBy(
        client.mutation(api.articles.publishArticle, { id })
      )
      // The client's own error: wrapped, with the request id.
      expect(error).toBeInstanceOf(ConvexError)
      const message = (error as Error).message
      expect(message).toMatch(
        /^\[CONVEX M\(articles:publishArticle\)\] \[Request ID: 6a1f0c9e2b7d4e3a\] Server Error/
      )
      expect(message).toMatch(/\n {2}Called by client$/)
      if (deployment === 'production')
        expect(message).not.toContain('outside-host.example')
      // What the page shows: the refusal, word for word, and nothing else.
      expect(publishErrorFeedback(error)).toEqual({
        variant: 'destructive',
        title: 'Could not publish',
        detail:
          'This image cannot be used: https://outside-host.example/pictures/one.png. Images must be uploaded, or come from img.youtube.com, images.unsplash.com, plus.unsplash.com or arweave.net.',
      })
      expect(publishErrorFeedback(error).detail).toBe(
        imageSourceRefusal(outside)
      )
    } finally {
      await client.close()
    }
  }
)

test.each(DEPLOYMENTS)(
  'publish: the writer sees the refusal alone, from the HTTP client, on a %s deployment',
  async (deployment) => {
    const { id, refusal } = await publishRefusal()
    const client = new ConvexHttpClient(OWN, {
      fetch: failingFetch({
        errorMessage: serverMessage(deployment, refusal.error),
        errorData: refusal.errorData,
      }),
      logger: false,
    })
    const error = await thrownBy(
      client.mutation(api.articles.publishArticle, { id })
    )
    expect(error).toBeInstanceOf(ConvexError)
    expect((error as Error).message).toMatch(
      /^\[Request ID: 6a1f0c9e2b7d4e3a\] Server Error/
    )
    expect(publishErrorFeedback(error).detail).toBe(imageSourceRefusal(outside))
  }
)

test.each(DEPLOYMENTS)(
  'publish: a failure that is not a refusal shows the plain line, not the client error, on a %s deployment',
  async (deployment) => {
    const { id } = await publishRefusal()
    const client = reactClient({
      errorMessage: serverMessage(
        deployment,
        new Error('Database connection lost')
      ),
    })
    try {
      const error = await thrownBy(
        client.mutation(api.articles.publishArticle, { id })
      )
      expect(error).not.toBeInstanceOf(ConvexError)
      expect((error as Error).message).toContain('[Request ID:')
      expect(publishErrorFeedback(error)).toEqual({
        variant: 'destructive',
        title: 'Could not publish',
        detail: PUBLISH_FAILED_DETAIL,
      })
      expect(PUBLISH_FAILED_DETAIL).toBe(
        'Something went wrong. Check your connection and try again.'
      )
    } finally {
      await client.close()
    }
  }
)

test.each(DEPLOYMENTS)(
  'avatar save: the refusal of a photo that is not an upload reads alone, on a %s deployment',
  async (deployment) => {
    const { writer } = await setup()
    const photo = 'https://outside-host.example/photos/me.png'
    const refusal = await refusedBy(
      writer.mutation(api.users.updateProfile, { avatar: photo })
    )
    const client = reactClient({
      errorMessage: serverMessage(deployment, refusal.error),
      errorData: refusal.errorData,
    })
    try {
      const error = await thrownBy(
        client.mutation(api.users.updateProfile, { avatar: photo })
      )
      expect((error as Error).message).toMatch(
        /^\[CONVEX M\(users:updateProfile\)\]/
      )
      expect(convexErrorMessage(error)).toBe(
        'This photo cannot be used: https://outside-host.example/photos/me.png. Profile photos must be uploaded.'
      )
      expect(convexErrorMessage(error)).toBe(avatarSourceRefusal(photo))
    } finally {
      await client.close()
    }
  }
)

const photoFile = () =>
  new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', {
    type: 'image/png',
  })

test.each(DEPLOYMENTS)(
  'photo and image uploads: a refusal reads alone and any other failure reads plainly, on a %s deployment',
  async (deployment) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { writer } = await setup()
    const refusal = await refusedBy(
      writer.mutation(api.users.updateProfile, { avatar: outside })
    )
    const refusing = reactClient({
      errorMessage: serverMessage(deployment, refusal.error),
      errorData: refusal.errorData,
    })
    const failing = reactClient({
      errorMessage: serverMessage(deployment, new Error('Not authenticated')),
    })
    try {
      // The upload starts with the `uploadIngress:issueTicket` action.
      expect(await uploadAvatarFile(photoFile(), refusing)).toEqual({
        success: false,
        error: avatarSourceRefusal(outside),
      })
      expect(await uploadFile(photoFile(), refusing, 'article_image')).toEqual({
        success: false,
        error: avatarSourceRefusal(outside),
      })
      expect(await uploadAvatarFile(photoFile(), failing)).toEqual({
        success: false,
        error: 'The upload failed. Try again.',
      })
      expect(await uploadFile(photoFile(), failing, 'article_image')).toEqual({
        success: false,
        error: 'The upload failed. Try again.',
      })
    } finally {
      await refusing.close()
      await failing.close()
    }
  }
)

test('a publish message shows in one place: the open dialog, else the open drawer, else the notice', () => {
  expect(publishFeedbackPlace({ confirmOpen: true, drawerOpen: true })).toBe(
    'confirm'
  )
  expect(publishFeedbackPlace({ confirmOpen: true, drawerOpen: false })).toBe(
    'confirm'
  )
  expect(publishFeedbackPlace({ confirmOpen: false, drawerOpen: true })).toBe(
    'drawer'
  )
  expect(publishFeedbackPlace({ confirmOpen: false, drawerOpen: false })).toBe(
    'notice'
  )
})

test('the workspace renders the publish message in its one place, and the publish catch adds no toast', () => {
  const root = join(__dirname, '../..')
  const view = readFileSync(
    join(root, 'components/editor/WritingWorkspaceView.tsx'),
    'utf8'
  )
  const gates = [...view.matchAll(/\{w\.publishFeedback &&([^(]*)\(/g)].map(
    (match) => (match[1] ?? '').trim()
  )
  expect(gates).toEqual([
    "feedbackPlace === 'notice' &&",
    "feedbackPlace === 'drawer' &&",
    "feedbackPlace === 'confirm' &&",
  ])
  const workspace = readFileSync(
    join(root, 'components/editor/useWritingWorkspace.ts'),
    'utf8'
  )
  const publishCatch = workspace.slice(
    workspace.indexOf("console.error('Publish error:'"),
    workspace.indexOf('publishingRef.current = false')
  )
  expect(publishCatch).toContain(
    'setPublishFeedback(publishErrorFeedback(error))'
  )
  expect(publishCatch).not.toContain('toast')
})

test('convexErrorMessage reads string data and a data message, and nothing else', () => {
  expect(convexErrorMessage(new ConvexError('  Refused.  '))).toBe('Refused.')
  expect(convexErrorMessage(new ConvexError({ message: 'Refused.' }))).toBe(
    'Refused.'
  )
  expect(convexErrorMessage(new ConvexError({ code: 'X' }))).toBeNull()
  expect(convexErrorMessage(new ConvexError(''))).toBeNull()
  expect(convexErrorMessage(new Error('[CONVEX M(x:y)] Server Error'))).toBe(
    null
  )
  expect(convexErrorMessage('Refused.')).toBeNull()
})
