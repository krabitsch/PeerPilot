const Minio = require('minio')
const multer = require('multer')

// ── Uploader (shared multer config) ──────────────────
const ALLOWED_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]

// Audio recordings of evaluations. Kept separate from ALLOWED_TYPES so the
// general document uploader doesn't start accepting media, and so recordings
// can have their own (larger) size limit.
const AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',   // .mp3
  'audio/mp4',    // .m4a (some browsers)
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
]

const makeUploader = (allowed, maxBytes) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxBytes },
  fileFilter: (req, file, cb) => {
    if (allowed.includes(file.mimetype))
      cb(null, true)
    else
      cb(new Error(`File type not allowed: ${file.mimetype}`))
  }
})

// Documents/images (submissions, avatars, assignment subjects): 50 MB.
const uploader = makeUploader(ALLOWED_TYPES, 50 * 1024 * 1024)

// Evaluation recordings: audio only, up to 200 MB (a full evaluation can run
// long). nginx's client_max_body_size must allow at least this on the upload path.
const recordingUploader = makeUploader(AUDIO_TYPES, 200 * 1024 * 1024)

// ── Storage (per bucket) ─────────────────────────────
const isProd = process.env.NODE_ENV === 'production'

// In production the credentials must be supplied; falling back to a
// well-known default there would leave object storage wide open.
const requireCredential = (name) => {
  const value = process.env[name]
  if (value) return value
  if (isProd) throw new Error(`${name} must be set in production`)
  return 'minioadmin'
}

const client = new Minio.Client({
  endPoint:  process.env.MINIO_ENDPOINT || 'minio',
  port:      parseInt(process.env.MINIO_PORT) || 9000,
  useSSL:    process.env.MINIO_USE_SSL === 'true',
  accessKey: requireCredential('MINIO_ACCESS_KEY'),
  secretKey: requireCredential('MINIO_SECRET_KEY'),
})

// Where a browser reaches the files: nginx proxies /files/ to MinIO, so this
// is the public origin of the stack, not of the MinIO container.
const publicBase = `${(process.env.BASE_URL || 'https://localhost').replace(/\/+$/, '')}/files`

// The origin MinIO itself signs URLs with, which has to be rewritten to the
// public one before a presigned link is handed to a browser.
const internalOrigin = `http://${process.env.MINIO_ENDPOINT || 'minio'}:${parseInt(process.env.MINIO_PORT) || 9000}`

const createStorage = (bucket) => {
  return {
    upload: (fileName, buffer, mimetype, size) =>
      client.putObject(bucket, fileName, buffer, size, { 'Content-Type': mimetype }),

    getUrl: async (fileName, originalName, expirySeconds = 600) => {
      const url = await client.presignedGetObject(bucket, fileName, expirySeconds, {
        'response-content-disposition': `attachment; filename="${originalName}"`
      })
      return url.replace(internalOrigin, publicBase)
    },

    // Readable stream of an object, for piping straight into a response or an
    // archive without buffering the whole file in memory.
    getStream: (fileName) =>
      client.getObject(bucket, fileName),

    delete: (fileName) =>
      client.removeObject(bucket, fileName),

    ensureBucket: async () => {
      const exists = await client.bucketExists(bucket)
      if (!exists) await client.makeBucket(bucket)
    },

    makePublic: async () => {
      const policy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucket}/*`]
        }]
      })
      await client.setBucketPolicy(bucket, policy)
    },

    getPublicUrl: (fileName) =>
      `${publicBase}/${bucket}/${fileName}`
  }
}

module.exports = { uploader, recordingUploader, createStorage }