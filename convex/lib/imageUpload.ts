export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]

export function matchesImageSignature(
  bytes: Uint8Array,
  type: string
): boolean {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length))
  if (type === 'image/png')
    return [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
  if (type === 'image/jpeg')
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6))
  return (
    type === 'image/webp' && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP'
  )
}

export async function readImage(request: Request): Promise<Blob> {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
  if (!IMAGE_TYPES.includes(type)) throw new Error('Unsupported image type')
  if (Number(request.headers.get('content-length')) > MAX_IMAGE_BYTES)
    throw new Error('Image exceeds 10MB')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Missing image')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10MB')
      chunks.push(new Uint8Array(value))
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  const blob = new Blob(chunks, { type })
  if (
    !matchesImageSignature(
      new Uint8Array(await blob.slice(0, 12).arrayBuffer()),
      type
    )
  )
    throw new Error('Invalid image content')
  return blob
}
