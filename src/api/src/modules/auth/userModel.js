const { prisma } = require('@transcendence/database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { NotFoundError, ConflictError, ForbiddenError } = require('@transcendence/errors');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

// Everything here goes through the Prisma client, like the rest of the API.
// The functions return the same flat shapes the raw-SQL versions did (e.g.
// `pass_hash` directly on the user), because the controller reads them that way.
//
// Where the old SQL was an UPDATE or DELETE that silently matched nothing, this
// uses updateMany/deleteMany: Prisma's update/delete throw on a missing row.

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const generateUsername = async (email) => {
  let base = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (!base) base = 'user';
  let username = base;
  let counter = 1;
  while (true) {
    const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!existing) return username;
    username = `${base}${counter++}`;
  }
};

// ========== USERS ==========
const createUser = async (email, plainPassword, orgId = null) => {
  const pass_hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
  const username = await generateUsername(email);
  // The user and its auth row are created in one statement, so a failure can no
  // longer leave a user without credentials behind.
  return await prisma.user.create({
    data: {
      email,
      username,
      role: 'Student',
      orgId,
      // Auto-verified: this deployment has no mail service to verify through,
      // and access is already gated by the email whitelist at registration.
      userAuth: { create: { pass_hash, provider: 'local', email_verified: true } },
    },
    select: { id: true, email: true, username: true, created_at: true },
  });
};

const findUserByEmail = async (email) => {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, email: true, username: true, role: true,
      userAuth: {
        select: {
          pass_hash: true, provider: true, email_verified: true,
          verification_token_hash: true, verification_token_expiry: true,
          reset_token_hash: true, reset_token_expiry: true,
        },
      },
    },
  });
  if (!user) return undefined;
  const auth = user.userAuth ?? {};
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    pass_hash: auth.pass_hash ?? null,
    provider: auth.provider ?? null,
    email_verified: auth.email_verified ?? null,
    verification_token_hash: auth.verification_token_hash ?? null,
    verification_token_expiry: auth.verification_token_expiry ?? null,
    reset_token_hash: auth.reset_token_hash ?? null,
    reset_token_expiry: auth.reset_token_expiry ?? null,
  };
};

// ========== REFRESH TOKENS ==========
const storeRefreshToken = async (userId, refreshToken, expiresAt) => {
  await prisma.refreshToken.create({
    data: { tokenHash: hashToken(refreshToken), userId, expiresAt },
  });
};

const findRefreshToken = async (refreshToken) => {
  return (await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
  })) ?? undefined;
};

const deleteRefreshToken = async (refreshToken) => {
  await prisma.refreshToken.deleteMany({ where: { tokenHash: hashToken(refreshToken) } });
};

const deleteAllUserRefreshTokens = async (userId) => {
  await prisma.refreshToken.deleteMany({ where: { userId } });
};

// ========== OAUTH ==========
const oauthUserFields = {
  id: true, email: true, username: true,
  userAuth: { select: { provider: true, provider_user_id: true, email_verified: true } },
};

const flattenOAuthUser = (user) => ({
  id: user.id,
  email: user.email,
  username: user.username,
  provider: user.userAuth.provider,
  provider_user_id: user.userAuth.provider_user_id,
  email_verified: user.userAuth.email_verified,
});

const findOrCreateOAuthUser = async (provider, providerUserId, email, name) => {
  const linked = await prisma.user.findFirst({
    where: { userAuth: { provider, provider_user_id: providerUserId } },
    select: oauthUserFields,
  });
  if (linked) return flattenOAuthUser(linked);

  // Check if this email is already registered under any provider
  const existing = await prisma.user.findFirst({
    where: { email, userAuth: { isNot: null } },
    select: oauthUserFields,
  });

  if (existing) {
    if (existing.userAuth.provider === 'local') {
      throw new ConflictError('Email already registered with password. Please log in using your password.');
    }
    // Email registered via a different OAuth provider — link by email, return existing user
    const { provider_user_id, ...rest } = flattenOAuthUser(existing);
    return rest;
  }

  // New user — must be on the invite list
  const allowed = await isEmailAllowed(email);
  if (!allowed) {
    const err = new ForbiddenError('Registration not permitted for this email address.');
    err.code = 'INVITE_REQUIRED';
    throw err;
  }

  const username = await generateUsername(email);
  const user = await prisma.user.create({
    data: {
      email,
      username,
      role: 'Student',
      orgId: allowed.orgId,
      userAuth: { create: { provider, provider_user_id: providerUserId, email_verified: true } },
    },
    select: { id: true, email: true, username: true },
  });
  await markEmailAsUsed(email);
  return { ...user, email_verified: true };
};

// ========== PASSWORD RESET ==========
const saveResetToken = async (userId, tokenHash, expiresAt) => {
  await prisma.userAuth.updateMany({
    where: { userId },
    data: { reset_token_hash: tokenHash, reset_token_expiry: expiresAt },
  });
};

const findUserByResetToken = async (tokenHash) => {
  const user = await prisma.user.findFirst({
    where: { userAuth: { reset_token_hash: tokenHash, reset_token_expiry: { gt: new Date() } } },
    select: { id: true, email: true, userAuth: { select: { pass_hash: true } } },
  });
  if (!user) return undefined;
  return { id: user.id, email: user.email, pass_hash: user.userAuth.pass_hash };
};

const clearResetToken = async (userId) => {
  await prisma.userAuth.updateMany({
    where: { userId },
    data: { reset_token_hash: null, reset_token_expiry: null },
  });
};

const updatePassword = async (userId, newHashedPassword) => {
  await prisma.userAuth.updateMany({
    where: { userId },
    data: { pass_hash: newHashedPassword },
  });
};

// ========== EMAIL VERIFICATION ==========
const storeVerificationToken = async (userId, tokenHash, expiresAt) => {
  await prisma.userAuth.updateMany({
    where: { userId },
    data: { verification_token_hash: tokenHash, verification_token_expiry: expiresAt },
  });
};

const findUserByVerificationToken = async (tokenHash) => {
  return (await prisma.user.findFirst({
    where: {
      userAuth: { verification_token_hash: tokenHash, verification_token_expiry: { gt: new Date() } },
    },
    select: { id: true, email: true },
  })) ?? undefined;
};

const verifyEmail = async (userId) => {
  await prisma.userAuth.updateMany({
    where: { userId },
    data: { email_verified: true, verification_token_hash: null, verification_token_expiry: null },
  });
};

// ========== ALLOWED EMAILS ==========
const isEmailAllowed = async (email) => {
  return await prisma.authAllowedEmail.findFirst({
    where: { email, used: false },
    select: { orgId: true },
  });
};

const markEmailAsUsed = async (email) => {
  await prisma.authAllowedEmail.updateMany({ where: { email }, data: { used: true } });
};

const unmarkEmailAsUsed = async (email) => {
  await prisma.authAllowedEmail.updateMany({ where: { email }, data: { used: false } });
};

const deleteUserById = async (userId) => {
  await prisma.user.deleteMany({ where: { id: userId } });
};

// ========== INVITATIONS ==========
const addAllowedEmail = async (email, invitedBy, orgId = null) => {
  if (orgId != null) {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) {
      throw new NotFoundError('Organization not found.');
    }
  }
  const existing = await prisma.authAllowedEmail.findUnique({
    where: { email },
    select: { id: true, used: true },
  });
  if (existing) {
    throw new ConflictError(
      existing.used ? 'Email is already registered.' : 'Email has already been invited.'
    );
  }
  return await prisma.authAllowedEmail.create({
    data: { email, invited_by: invitedBy ?? null, orgId },
    select: { id: true, email: true, used: true, invited_by: true, orgId: true, created_at: true },
  });
};

const getAllowedEmails = async (orgId = null) => {
  const rows = await prisma.authAllowedEmail.findMany({
    where: orgId != null ? { orgId } : undefined,
    // id breaks ties between invites created in the same instant.
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: {
      id: true, email: true, used: true, created_at: true, orgId: true,
      invitedBy: { select: { username: true } },
    },
  });
  return rows.map(({ invitedBy, ...row }) => ({
    ...row,
    invited_by_username: invitedBy?.username ?? null,
  }));
};

const revokeAllowedEmail = async (id) => {
  const invite = await prisma.authAllowedEmail.findUnique({
    where: { id: parseInt(id) },
    select: { id: true, used: true },
  });
  if (!invite) {
    throw new NotFoundError('Invite not found.');
  }
  if (invite.used) {
    throw new ConflictError('Cannot revoke an already-used invite.');
  }
  await prisma.authAllowedEmail.delete({ where: { id: invite.id } });
};

const findUserById = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, username: true, role: true, created_at: true, orgId: true,
      profile: { select: { bio: true, avatar: true, last_update: true } },
    },
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    created_at: user.created_at,
    orgId: user.orgId,
    profile: user.profile
      ? { bio: user.profile.bio, avatar: user.profile.avatar, last_update: user.profile.last_update }
      : null,
  };
};

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  findOrCreateOAuthUser,
  storeRefreshToken,
  findRefreshToken,
  deleteRefreshToken,
  deleteAllUserRefreshTokens,
  saveResetToken,
  findUserByResetToken,
  clearResetToken,
  updatePassword,
  storeVerificationToken,
  findUserByVerificationToken,
  verifyEmail,
  isEmailAllowed,
  markEmailAsUsed,
  unmarkEmailAsUsed,
  deleteUserById,
  addAllowedEmail,
  getAllowedEmails,
  revokeAllowedEmail,
};
