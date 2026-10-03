const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const logger = require('@transcendence/logger');
const { AppError, NotFoundError, ValidationError, UnauthorizedError, ForbiddenError, ConflictError } = require('@transcendence/errors');
require('dotenv').config();

const {
    findOrCreateOAuthUser,
    createUser,
    findUserByEmail,
    findUserById,
    storeRefreshToken,
    findRefreshToken,
    deleteRefreshToken,
    isEmailAllowed,
    markEmailAsUsed,
    addAllowedEmail,
    getAllowedEmails,
    revokeAllowedEmail,
} = require('./userModel');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken,
        validatePasswordStrength } = require('./utils');











exports.register = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new ValidationError('Email and password required');
    }

    const allowedEmail = await isEmailAllowed(email);
    if (!allowedEmail) {
      throw new ForbiddenError('Registration not permitted for this email address.');
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      throw new ConflictError('Email already exists');
    }

    const passwordStrength = validatePasswordStrength(password);
    if (!passwordStrength.isValid) {
      const err = new ValidationError('Password too weak');
      err.suggestions = passwordStrength.suggestions;
      throw err;
    }

    // No mail service in this deployment: whitelisted accounts are created
    // already verified and can sign in immediately. (See GOING-LIVE.md.)
    const user = await createUser(email, password, allowedEmail.orgId);
    await markEmailAsUsed(email);   // consume the whitelist entry

    return res.status(201).json({
      id: user.id,
      email: user.email,
      message: 'Registration successful. You can now sign in.'
    });
  } catch (err) {
    return next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new ValidationError('Email and password required');
    }
    const user = await findUserByEmail(email);
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }
    const valid = await bcrypt.compare(password, user.pass_hash);
    if (!valid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await storeRefreshToken(user.id, refreshToken, expiresAt);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth'
    });
    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
};

exports.refresh = async (req, res, next) => {
    try {
        const oldRefreshToken = req.cookies.refreshToken;
        if (!oldRefreshToken) {
            throw new UnauthorizedError('No refresh token');
        }

        // 1. Check DB for old token (exists? not expired?)
        const storedToken = await findRefreshToken(oldRefreshToken); // uses hash lookup
        if (!storedToken || storedToken.expiresAt < new Date()) {
            throw new ForbiddenError('Invalid or expired refresh token');
        }

        // 2. Verify JWT signature
        const payload = verifyRefreshToken(oldRefreshToken);

        // 3. Delete the old refresh token from DB (rotation)
        await deleteRefreshToken(oldRefreshToken);

        // 4. Generate new access token and NEW refresh token
        const newAccessToken = generateAccessToken(payload.userId, payload.email);
        const newRefreshToken = generateRefreshToken(payload.userId, payload.email);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        // 5. Store new refresh token (hashed)
        await storeRefreshToken(payload.userId, newRefreshToken, expiresAt);

        // 6. Set new refresh token as cookie (overwrite old one)
        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/api/auth'
        });

        // 7. Return new access token
        res.json({ accessToken: newAccessToken });
    } catch (err) {
        next(err instanceof AppError ? err : new ForbiddenError('Invalid refresh token'));
    }
};

exports.logout = async (req, res, next) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        if (refreshToken) {
            await deleteRefreshToken(refreshToken);
            res.clearCookie('refreshToken', { path: '/api/auth' });
        }
        res.status(204).send();
    } catch (err) {
        next(err);
    }
};

exports.getMe = async (req, res, next) => {
    try {
        if (!req.user) {
            throw new UnauthorizedError('Not authenticated');
        }
        const user = await findUserById(req.user.userId);
        if (!user) {
            throw new NotFoundError('User not found');
        }
        res.json(user);
    } catch (err) {
        next(err);
    }
};




// ---------- Forgot Password ----------
// Password reset is handled out-of-band: this deployment sends no email, so a
// user who forgets their password asks an admin, who resets it from the admin
// panel (POST /api/user/:id/reset-password). The emailed forgot/reset flow is
// gone. See GOING-LIVE.md.

// ---------- Google OAuth ----------
// Set up Google OAuth2 client
const googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.GOOGLE_REDIRECT_URI}`
);

// Redirect user to Google consent screen
exports.googleAuth = (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, {
        httpOnly: true, sameSite: 'lax',
        maxAge: 10 * 60 * 1000, path: '/'
    });
    const url = googleClient.generateAuthUrl({
        access_type: 'offline',
        scope: ['profile', 'email'],
        prompt: 'consent',
        state,
    });
    res.redirect(url);
};

// Handle callback from Google
exports.googleCallback = async (req, res) => {
    try {
        const { code, state } = req.query;
        if (!state || state !== req.cookies.oauth_state) {
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
        }
        res.clearCookie('oauth_state', { path: '/' });
        if (!code) throw new Error('No code provided');

        // Exchange code for tokens
        const { tokens } = await googleClient.getToken(code);
        googleClient.setCredentials(tokens);

        // Verify ID token
        const ticket = await googleClient.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { email, name, picture, sub: googleId } = payload;

        if (!email) throw new Error('Email not provided by Google');

        // Create or find user in our DB
        const user = await findOrCreateOAuthUser('google', googleId, email, name);

        // Generate our own access/refresh tokens
        const accessToken = generateAccessToken(user.id, user.email);
        const refreshToken = generateRefreshToken(user.id, user.email);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        await storeRefreshToken(user.id, refreshToken, expiresAt);

        // Set httpOnly cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/api/auth'
        });

        const frontendUrl = `${process.env.FRONTEND_URL}/oauth-callback#accessToken=${accessToken}`;
        res.redirect(frontendUrl);
    } catch (err) {
        if (err.code === 'INVITE_REQUIRED') {
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=not_invited`);
        }
        logger.error('auth-service', 'Google OAuth callback failed', { message: err.message, stack: err.stack });
        res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
    }
};

// ---------- GitHub OAuth ----------
exports.githubAuth = (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, {
        httpOnly: true, sameSite: 'lax',
        maxAge: 10 * 60 * 1000, path: '/'
    });
    const githubAuthUrl = `https://github.com/login/oauth/authorize?` +
        `client_id=${process.env.GITHUB_CLIENT_ID}&` +
        `redirect_uri=${process.env.GITHUB_REDIRECT_URI}&` +
        `scope=user:email&` +
        `state=${state}`;
    res.redirect(githubAuthUrl);
};

exports.githubCallback = async (req, res) => {
    const { code, state } = req.query;
    if (!state || state !== req.cookies.oauth_state) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
    }
    res.clearCookie('oauth_state', { path: '/' });
    if (!code) return res.status(400).send('No code provided');

    try {
        // Exchange code for access token
        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code,
                redirect_uri: process.env.GITHUB_REDIRECT_URI,
            }),
        });
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        if (!accessToken) throw new Error('No access token from GitHub');

        // Fetch user info from GitHub API
        const userResponse = await fetch('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const userData = await userResponse.json();
        const { login: username, id: githubId, avatar_url: picture, email: primaryEmail } = userData;

        // GitHub may not return email if it's private; we need to fetch emails separately
        let email = primaryEmail;
        if (!email) {
            const emailResponse = await fetch('https://api.github.com/user/emails', {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            const emails = await emailResponse.json();
            const primary = emails.find(e => e.primary && e.verified);
            email = primary ? primary.email : emails[0]?.email;
            if (!email) throw new Error('No email found for GitHub user');
        }

        // Create or find user in our DB (provider = 'github')
        const user = await findOrCreateOAuthUser('github', String(githubId), email, username);

        // Generate our own tokens
        const newAccessToken = generateAccessToken(user.id, user.email);
        const refreshToken = generateRefreshToken(user.id, user.email);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        await storeRefreshToken(user.id, refreshToken, expiresAt);

        // Set refresh token cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/api/auth',
        });

        // Redirect to frontend with access token
        const frontendUrl = `${process.env.FRONTEND_URL}/oauth-callback#accessToken=${newAccessToken}`;
        res.redirect(frontendUrl);
    } catch (err) {
        if (err.code === 'INVITE_REQUIRED') {
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=not_invited`);
        }
        logger.error('auth-service', 'GitHub OAuth callback failed', { message: err.message, stack: err.stack });
        res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
    }
};


// ---------- Invitations ----------
exports.createInvite = async (req, res, next) => {
    try {
        const { email, orgId } = req.body;
        if (!email) throw new ValidationError('Email required');
        let parsedOrgId = null;
        if (orgId != null) {
            parsedOrgId = parseInt(orgId, 10);
            if (Number.isNaN(parsedOrgId)) throw new ValidationError('Invalid orgId');
        }
        const invite = await addAllowedEmail(email, req.user.userId, parsedOrgId);
        res.status(201).json(invite);
    } catch (err) {
        next(err);
    }
};

exports.getInvites = async (req, res, next) => {
    try {
        const { orgId } = req.query;
        const parsedOrgId = orgId != null ? parseInt(orgId, 10) : null;
        const invites = await getAllowedEmails(Number.isNaN(parsedOrgId) ? null : parsedOrgId);
        res.json(invites);
    } catch (err) {
        next(err);
    }
};

exports.revokeInvite = async (req, res, next) => {
    try {
        await revokeAllowedEmail(req.params.id);
        res.status(204).send();
    } catch (err) {
        next(err);
    }
};