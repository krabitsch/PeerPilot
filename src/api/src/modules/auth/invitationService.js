const { prisma } = require('@transcendence/database')
const crypto = require('crypto')
const bcrypt = require('bcrypt')
const { isPendingAuth } = require('@transcendence/utils')
const { ValidationError, ForbiddenError, NotFoundError, ConflictError } = require('@transcendence/errors')
const { sendInvitationEmail } = require('../../services/mailService')
const { normalizeEmail, invitationStatus } = require('../../services/invitationState')
const { generateUsername } = require('./userModel')
const invalid = () => new ValidationError('This invitation link is invalid or has expired. Please request a new invitation from your course administrator.')
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex')
const validToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
const positiveId = value => {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) throw new ValidationError('Invalid ID')
  return id
}
// Case-insensitive lookup fails closed on ambiguous legacy identities.
const account = async (db, email) => {
  const users = await db.user.findMany({ where: { email: { equals: normalizeEmail(email), mode: 'insensitive' } }, include: { userAuth: true } })
  if (users.length > 1) throw new ConflictError('This account requires administrator assistance.')
  return users[0] ?? null
}
const registered = user => !!user && !isPendingAuth(user.userAuth)
const scope = async (actor, value, required = false) => {
  let orgId = value == null ? null : positiveId(value)
  if (actor.role === 'Bocal') {
    if (!actor.orgId || (orgId != null && orgId !== actor.orgId)) throw new ForbiddenError('You can only manage your own organisation.')
    orgId = actor.orgId
  } else if (actor.role !== 'Admin') throw new ForbiddenError()
  if (required && orgId == null) throw new ValidationError('Organization required')
  if (orgId != null && !await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } })) throw new NotFoundError('Organization not found')
  return orgId
}
const scopedEntry = async (actor, id, orgId) => {
  const wantedOrg = await scope(actor, orgId)
  const entry = await prisma.authAllowedEmail.findUnique({ where: { id: positiveId(id) } })
  if (!entry || (wantedOrg != null && entry.orgId !== wantedOrg)) throw new NotFoundError('Whitelist entry not found')
  return entry
}
const getInvitation = async (token, db = prisma) => {
  if (!validToken(token)) throw invalid()
  const entry = await db.authAllowedEmail.findUnique({ where: { invite_token_hash: hashToken(token) } })
  if (!entry || entry.used || !entry.invite_token_expiry || entry.invite_token_expiry <= new Date()) throw invalid()
  const user = await account(db, entry.email)
  if (registered(user) || (user?.orgId != null && user.orgId !== entry.orgId)) throw invalid()
  return { entry, user }
}
const validateInvitation = async token => {
  const { entry } = await getInvitation(token)
  return { email: normalizeEmail(entry.email) }
}
const redeemInvitation = async (token, password) => {
  await getInvitation(token) // reject invalid links before expensive password hashing
  const pass_hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12)
  return prisma.$transaction(async tx => {
    const { entry, user } = await getInvitation(token, tx)
    // Conditional update takes the row lock. Concurrent redemption/resend/revoke
    // must win this gate before credentials can be changed; failures roll back.
    const consumed = await tx.authAllowedEmail.updateMany({
      where: { id: entry.id, used: false, invite_token_hash: hashToken(token), invite_token_expiry: { gt: new Date() } },
      data: { used: true, invite_token_hash: null, invite_token_expiry: null },
    })
    if (consumed.count !== 1) throw invalid()
    if (user) {
      const claimed = await tx.userAuth.updateMany({
        where: { userId: user.id, provider: 'local', pass_hash: null },
        data: { pass_hash, email_verified: true },
      })
      if (claimed.count !== 1) throw invalid()
      return { id: user.id, email: user.email }
    }
    return tx.user.create({ data: {
      email: normalizeEmail(entry.email), username: await generateUsername(entry.email, tx),
      role: 'Student', orgId: entry.orgId,
      userAuth: { create: { provider: 'local', pass_hash, email_verified: true } },
    }, select: { id: true, email: true } })
  })
}
const listInvitations = async (actor, orgId) => {
  const scopedOrg = await scope(actor, orgId)
  const rows = await prisma.authAllowedEmail.findMany({
    where: scopedOrg == null ? {} : { orgId: scopedOrg }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: { id: true, email: true, orgId: true, used: true, created_at: true, invite_sent_at: true, invite_token_expiry: true, invitedBy: { select: { username: true } } },
  })
  return Promise.all(rows.map(async ({ invitedBy, ...row }) => {
    const isRegistered = registered(await account(prisma, row.email))
    return { ...row, registered: isRegistered, invitation_status: invitationStatus(row, isRegistered), invited_by_username: invitedBy?.username ?? null }
  }))
}
const sendInvitation = async (actor, id, orgId) => {
  const entry = await scopedEntry(actor, id, orgId)
  const user = await account(prisma, entry.email)
  if (registered(user)) throw new ConflictError('This account is already registered.')
  if (user?.orgId != null && user.orgId !== entry.orgId) throw new ConflictError('Account organisation does not match whitelist.')
  const hours = Number(process.env.INVITATION_EXPIRY_HOURS || 168)
  if (!Number.isFinite(hours) || hours <= 0) throw new ValidationError('Invalid invitation lifetime configuration')
  let url
  try {
    url = new URL('/register', process.env.PUBLIC_APP_URL || process.env.BASE_URL)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
  } catch { throw new ValidationError('Configure PUBLIC_APP_URL before sending invitations.') }
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  url.searchParams.set('token', token)
  // A new send replaces the previous link. Revocation cannot be undone here.
  const updated = await prisma.authAllowedEmail.updateMany({
    where: { id: entry.id, used: entry.used, invite_token_hash: entry.invite_token_hash },
    data: { used: false, invite_token_hash: tokenHash, invite_token_expiry: new Date(Date.now() + hours * 3600000) },
  })
  if (updated.count !== 1) throw new ConflictError('Invitation changed. Please refresh and try again.')
  try {
    await sendInvitationEmail({ email: normalizeEmail(entry.email), url: url.toString(), hours })
    const sent = await prisma.authAllowedEmail.updateMany({ where: { id: entry.id, used: false, invite_token_hash: tokenHash }, data: { invite_sent_at: new Date() } })
    if (sent.count !== 1) throw new ConflictError('Invitation changed. Please refresh and try again.')
  } catch {
    await prisma.authAllowedEmail.updateMany({ where: { id: entry.id, invite_token_hash: tokenHash }, data: { invite_token_hash: null, invite_token_expiry: null, invite_sent_at: null } })
    // Never propagate SMTP errors that might contain credentials or mail content.
    throw new ValidationError('Invitation could not be sent. Please try again or contact your administrator.')
  }
  return { message: 'Invitation sent' }
}
const sendBulk = async (actor, { orgId, classId }) => {
  const selectedOrg = await scope(actor, orgId, classId == null)
  let emails = null
  let targetOrg = selectedOrg
  if (classId != null) {
    const course = await prisma.class.findUnique({ where: { id: positiveId(classId) }, select: { org_id: true } })
    if (!course || (selectedOrg != null && course.org_id !== selectedOrg)) throw new NotFoundError('Course not found')
    targetOrg = await scope(actor, course.org_id, true)
    const enrollments = await prisma.enrollment.findMany({ where: { classId: positiveId(classId), status: 'Active' }, select: { user: { select: { email: true } } } })
    emails = enrollments.map(e => normalizeEmail(e.user.email))
  } else if (actor.role === 'Bocal') throw new ValidationError('Select a course before sending invitations.')
  const entries = await listInvitations(actor, targetOrg)
  let sent = 0, failed = 0
  for (const entry of entries) {
    if (entry.registered || (emails && !emails.includes(normalizeEmail(entry.email)))) continue
    try { await sendInvitation(actor, entry.id, targetOrg); sent++ } catch { failed++ }
  }
  return { sent, failed }
}
module.exports = { hashToken, scope, scopedEntry, account, registered, validateInvitation, redeemInvitation, listInvitations, sendInvitation, sendBulk }
