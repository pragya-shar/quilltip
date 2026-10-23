/**
 * Regression check for #237 against a disposable anonymous local backend.
 * Start it with CONVEX_AGENT_MODE=anonymous bunx convex dev, then run:
 * bun scripts/verify-upload-ownership.ts
 * Synthetic users and drafts remain in that disposable backend.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConvexHttpClient } from 'convex/browser'
import { z } from 'zod'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = z
  .object({
    deploymentName: z.literal('anonymous-agent'),
    adminKey: z.string().min(1),
    ports: z.object({
      cloud: z.number().int().positive(),
      site: z.number().int().positive(),
    }),
  })
  .parse(
    JSON.parse(
      readFileSync(path.join(root, '.convex/local/default/config.json'), 'utf8')
    )
  )
const url = `http://127.0.0.1:${config.ports.cloud}`
const scratch = mkdtempSync(path.join(tmpdir(), 'quilltip-upload-qa-'))
const runId = randomUUID().slice(0, 8)
const ownerName = `upload-owner-${runId}`
const otherName = `upload-other-${runId}`
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=',
  'base64'
)
const metadata = {
  fileName: `synthetic-${runId}.png`,
  fileType: 'image/png',
  fileSize: png.byteLength,
  uploadType: 'article_image' as const,
}

function importRows(table: 'users' | 'fileUploads', rows: object[]) {
  const file = path.join(scratch, `${table}.json`)
  writeFileSync(file, JSON.stringify(rows), { mode: 0o600 })
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CONVEX_SELF_HOSTED_URL: url,
    CONVEX_SELF_HOSTED_ADMIN_KEY: config.adminKey,
  }
  delete env.CONVEX_DEPLOYMENT
  delete env.CONVEX_DEPLOY_KEY
  execFileSync(
    process.execPath,
    [
      path.join(root, 'node_modules/convex/bin/main.js'),
      'import',
      '--append',
      '--table',
      table,
      file,
    ],
    { cwd: scratch, env, stdio: 'pipe' }
  )
}

function actingAs(userId: Id<'users'>) {
  // The SDK intentionally hides admin impersonation from its public types.
  const client = new ConvexHttpClient(url, {
    logger: false,
  }) as ConvexHttpClient & {
    setAdminAuth(
      key: string,
      identity: { subject: string; issuer: string; tokenIdentifier: string }
    ): void
  }
  client.setAdminAuth(config.adminKey, {
    subject: userId,
    issuer: 'https://upload-qa.test',
    tokenIdentifier: `upload-qa|${userId}`,
  })
  return client
}

async function upload(client: ConvexHttpClient) {
  const ticket = await client.action(api.uploadIngress.issueTicket, {})
  assert.equal(ticket.url, `http://127.0.0.1:${config.ports.site}/image-upload`)
  const response = await fetch(ticket.url, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', 'X-Upload-Token': ticket.token },
    body: png,
  })
  assert.equal(response.status, 200, 'Synthetic image upload must succeed')
  const result = z
    .object({ storageId: z.string().min(1) })
    .parse(await response.json())
  return result.storageId as Id<'_storage'>
}

try {
  writeFileSync(
    path.join(scratch, 'package.json'),
    JSON.stringify({ dependencies: { convex: '*' } })
  )
  importRows(
    'users',
    [ownerName, otherName].map((username) => ({
      username,
      email: `${username}@uploads.test`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))
  )
  const publicClient = new ConvexHttpClient(url, { logger: false })
  const ownerUser = await publicClient.query(api.users.getUserByUsername, {
    username: ownerName,
  })
  const otherUser = await publicClient.query(api.users.getUserByUsername, {
    username: otherName,
  })
  assert(ownerUser && otherUser, 'Synthetic identities must exist')
  const owner = actingAs(ownerUser._id)
  const other = actingAs(otherUser._id)
  const storageId = await upload(owner)
  const first = await owner.mutation(api.uploads.storeFileMetadata, {
    ...metadata,
    storageId,
  })
  const otherDraft = await other.mutation(api.articles.saveDraft, {
    title: 'Synthetic upload QA draft',
    content: { type: 'doc', content: [] },
  })

  await assert.rejects(
    other.mutation(api.uploads.storeFileMetadata, { ...metadata, storageId }),
    /ownership could not be verified/
  )
  await assert.rejects(
    other.mutation(api.uploads.updateUserAvatar, {
      storageId,
      fileName: metadata.fileName,
    }),
    /ownership could not be verified/
  )
  await assert.rejects(
    other.mutation(api.uploads.updateArticleCoverImage, {
      storageId,
      fileName: metadata.fileName,
      articleId: otherDraft,
    }),
    /ownership could not be verified/
  )
  await assert.rejects(
    other.mutation(api.uploads.deleteFile, { fileId: first.fileId }),
    /Not authorized/
  )
  process.stdout.write(
    'PASS: cross-owner registration, avatar, cover, and deletion are rejected\n'
  )

  const second = await owner.mutation(api.uploads.storeFileMetadata, {
    ...metadata,
    storageId,
  })
  await owner.mutation(api.uploads.deleteFile, { fileId: first.fileId })
  assert(
    await publicClient.query(api.uploads.getFileUrl, { storageId }),
    'Deleting one reference must preserve the shared blob'
  )
  await owner.mutation(api.uploads.deleteFile, { fileId: second.fileId })
  assert.equal(
    await publicClient.query(api.uploads.getFileUrl, { storageId }),
    null
  )
  process.stdout.write(
    'PASS: owner deletion preserves shared references and removes the final unreferenced blob\n'
  )

  const inlineStorageId = await upload(owner)
  const inlineFile = await owner.mutation(api.uploads.storeFileMetadata, {
    ...metadata,
    storageId: inlineStorageId,
  })
  assert(inlineFile.url)
  const inlineDraft = await owner.mutation(api.articles.saveDraft, {
    title: 'Synthetic inline image draft',
    content: {
      type: 'doc',
      content: [{ type: 'resizableImage', attrs: { src: inlineFile.url } }],
    },
  })
  await assert.rejects(
    owner.mutation(api.uploads.deleteFile, { fileId: inlineFile.fileId }),
    /File is still in use/
  )
  assert(
    await publicClient.query(api.uploads.getFileUrl, {
      storageId: inlineStorageId,
    })
  )
  const sharedDraft = await other.mutation(api.articles.createArticle, {
    title: 'Synthetic shared image article',
    content: {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: `${inlineFile.url}?v=1#image` } },
      ],
    },
  })
  await owner.mutation(api.articles.saveDraft, {
    id: inlineDraft,
    title: 'Synthetic inline image draft',
    content: { type: 'doc', content: [] },
    coverImage: inlineFile.url,
  })
  await assert.rejects(
    owner.mutation(api.uploads.deleteFile, { fileId: inlineFile.fileId }),
    /File is still in use/
  )
  await owner.mutation(api.articles.deleteArticle, { id: inlineDraft })
  await assert.rejects(
    owner.mutation(api.uploads.deleteFile, { fileId: inlineFile.fileId }),
    /File is still in use/
  )
  await other.mutation(api.articles.updateArticle, {
    id: sharedDraft,
    content: { type: 'doc', content: [] },
  })
  await owner.mutation(api.uploads.deleteFile, { fileId: inlineFile.fileId })
  process.stdout.write(
    'PASS: saving editor image URLs without an upload articleId protects the blob\n'
  )

  const attachmentId = await upload(owner)
  const ownerDraft = await owner.mutation(api.articles.saveDraft, {
    title: 'Synthetic attachment QA draft',
    content: { type: 'doc', content: [] },
  })
  const { avatarUrl } = await owner.mutation(api.uploads.updateUserAvatar, {
    storageId: attachmentId,
    fileName: metadata.fileName,
  })
  const { imageUrl } = await owner.mutation(
    api.uploads.updateArticleCoverImage,
    {
      storageId: attachmentId,
      fileName: metadata.fileName,
      articleId: ownerDraft,
    }
  )
  assert.equal(
    (await owner.query(api.users.getCurrentUser, {}))?.avatar,
    avatarUrl
  )
  assert.equal(
    (await owner.query(api.articles.getArticleById, { id: ownerDraft }))
      ?.coverImage,
    imageUrl
  )
  const attachments = await owner.query(api.uploads.getUserUploads, {})
  const avatar = attachments.find(
    (row) => row.storageId === attachmentId && row.uploadType === 'avatar'
  )
  const cover = attachments.find(
    (row) => row.storageId === attachmentId && row.uploadType === 'cover_image'
  )
  assert(avatar && cover)
  await owner.mutation(api.uploads.deleteFile, { fileId: avatar._id })
  assert(
    await publicClient.query(api.uploads.getFileUrl, {
      storageId: attachmentId,
    })
  )
  await assert.rejects(
    owner.mutation(api.uploads.deleteFile, { fileId: cover._id }),
    /File is still in use/
  )
  await owner.mutation(api.users.clearAvatar, {})
  await assert.rejects(
    owner.mutation(api.uploads.deleteFile, { fileId: cover._id }),
    /File is still in use/
  )
  await owner.mutation(api.articles.deleteArticle, { id: ownerDraft })
  await owner.mutation(api.uploads.deleteFile, { fileId: cover._id })
  assert.equal(
    await publicClient.query(api.uploads.getFileUrl, {
      storageId: attachmentId,
    }),
    null
  )
  process.stdout.write(
    'PASS: owner avatar and cover attachment work; active references survive deletion attempts\n'
  )

  const forgedStorageId = await upload(owner)
  await owner.mutation(api.uploads.storeFileMetadata, {
    ...metadata,
    storageId: forgedStorageId,
  })
  importRows('fileUploads', [
    {
      ...metadata,
      storageId: forgedStorageId,
      uploadedBy: otherUser._id,
      createdAt: Date.now(),
    },
  ])
  const forged = (await other.query(api.uploads.getUserUploads, {})).find(
    (row) => row.storageId === forgedStorageId
  )
  assert(forged)
  await assert.rejects(
    other.mutation(api.uploads.deleteFile, { fileId: forged._id }),
    /ownership could not be verified/
  )
  assert(
    await publicClient.query(api.uploads.getFileUrl, {
      storageId: forgedStorageId,
    })
  )
  process.stdout.write('PASS: forged metadata never authorizes blob deletion\n')

  await assert.rejects(
    publicClient.action(api.uploadIngress.issueTicket, {}),
    /Not authenticated/
  )
  const ticket = await owner.action(api.uploadIngress.issueTicket, {})
  const send = (token: string, body: Buffer = png) =>
    fetch(ticket.url, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'X-Upload-Token': token },
      body: new Uint8Array(body),
    })
  assert.equal((await send('missing')).status, 401)
  assert.equal((await send(ticket.token)).status, 200)
  assert.equal((await send(ticket.token)).status, 401)
  const invalidImageTicket = await owner.action(
    api.uploadIngress.issueTicket,
    {}
  )
  assert.equal(
    (await send(invalidImageTicket.token, Buffer.from('not-an-image'))).status,
    400
  )
  const tooLargeTicket = await owner.action(api.uploadIngress.issueTicket, {})
  assert.equal(
    (await send(tooLargeTicket.token, Buffer.alloc(10 * 1024 * 1024 + 1)))
      .status,
    400
  )
  const preflight = await fetch(ticket.url, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://upload-qa.test',
      'Access-Control-Request-Headers': 'content-type,x-upload-token',
    },
  })
  assert.equal(preflight.status, 204)
  assert.match(
    preflight.headers.get('Access-Control-Allow-Headers') ?? '',
    /X-Upload-Token/
  )
  process.stdout.write(
    'PASS: signed-out, replay, invalid-image, size, and browser preflight checks\n'
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
