const { prisma } = require('@transcendence/database')
const crypto = require('crypto')
const bcrypt = require('bcrypt')
const logger = require('@transcendence/logger')
const { ValidationError } = require('@transcendence/errors')
const { normalizeEmail } = require('../../services/invitationState')
const { sendPasswordResetEmail } = require('../../services/mailService')
const { validatePasswordStrength } = require('./utils')

const MESSAGE = 'If an account exists for that email address, a password reset link has been sent.'
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex')
const invalid = () => new ValidationError('This password reset link is invalid or has expired. Please request a new password reset link.')
const registeredLocal = auth => auth?.provider === 'local' && typeof auth.pass_hash === 'string' && auth.pass_hash.length > 0

async function requestReset(email) {
  email = normalizeEmail(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) throw new ValidationError('Enter a valid email address.')
  try {
    // Fail closed for ambiguous legacy email variants; do not reveal account state.
    const users = await prisma.user.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, include: { userAuth: true } })
    if (users.length !== 1 || !registeredLocal(users[0].userAuth)) return { message: MESSAGE }
    const user = users[0], auth = user.userAuth
    const minutes = Number(process.env.PASSWORD_RESET_EXPIRY_MINUTES || 20)
    if (!Number.isFinite(minutes) || minutes <= 0) throw Error('Invalid reset configuration')
    const url = new URL('/reset-password', process.env.PUBLIC_APP_URL)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid reset URL')
    const token = crypto.randomBytes(32).toString('base64url')
    const tokenHash = hashToken(token)
    url.searchParams.set('token', token)
    const saved = await prisma.userAuth.updateMany({
      where: { userId: user.id, provider: 'local', pass_hash: auth.pass_hash, reset_token_hash: auth.reset_token_hash },
      data: { reset_token_hash: tokenHash, reset_token_expiry: new Date(Date.now() + minutes * 60000) },
    })
    if (saved.count !== 1) return { message: MESSAGE }
    try {
      await sendPasswordResetEmail({ email: normalizeEmail(user.email), url: url.toString(), minutes })
    } catch {
      // A failed older delivery must never clear a newer request's token.
      await prisma.userAuth.updateMany({ where: { userId: user.id, reset_token_hash: tokenHash },
        data: { reset_token_hash: null, reset_token_expiry: null } })
      throw Error('Reset mail failed')
    }
  } catch {
    // Never log SMTP errors, credentials, account identifiers, or reset links.
    logger.error('auth', 'Password reset request could not be completed')
  }
  return { message: MESSAGE }
}

async function findReset(token, db = prisma) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalid()
  const auth = await db.userAuth.findFirst({ where: {
    reset_token_hash: hashToken(token), reset_token_expiry: { gt: new Date() }, provider: 'local', pass_hash: { not: null },
  } })
  if (!registeredLocal(auth)) throw invalid()
  return auth
}
async function validateReset(token) {
  await findReset(token)
  return { valid: true }
}
async function resetPassword(token, password) {
  await findReset(token)
  if (typeof password !== 'string' || !password) throw new ValidationError('Password required')
  const strength = validatePasswordStrength(password)
  if (!strength.isValid) {
    const error = new ValidationError('Password too weak')
    error.suggestions = strength.suggestions
    throw error
  }
  const pass_hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12)
  await prisma.$transaction(async tx => {
    const auth = await findReset(token, tx)
    // Conditional replacement locks the auth row: only one redemption can win.
    const changed = await tx.userAuth.updateMany({ where: {
      userId: auth.userId, provider: 'local', pass_hash: auth.pass_hash,
      reset_token_hash: hashToken(token), reset_token_expiry: { gt: new Date() },
    }, data: { pass_hash, reset_token_hash: null, reset_token_expiry: null } })
    if (changed.count !== 1) throw invalid()
    await tx.refreshToken.deleteMany({ where: { userId: auth.userId } })
  })
  return { message: 'Your password has been changed. Please sign in with your new password.' }
}
module.exports = { MESSAGE, requestReset, validateReset, resetPassword }
