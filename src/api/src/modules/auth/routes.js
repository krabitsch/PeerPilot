const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('./controller');
const { authenticate, requireRole } = require('../../middleware/authenticate');

// AUTH_RATE_LIMIT_SCALE multiplies every limit below. The e2e suite raises it
// because all of its traffic comes from one IP; it is ignored in production so
// a stray variable can never loosen a live deployment.
const scale = process.env.NODE_ENV === 'production'
    ? 1
    : Math.max(1, parseInt(process.env.AUTH_RATE_LIMIT_SCALE, 10) || 1);

const limiter = (max, message) => rateLimit({
    windowMs: 15 * 60 * 1000, max: max * scale,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(200).json({ ok: false, error: message, code: 429 });
    },
});

router.post('/register',        limiter(5,  'Too many requests. Please try again in 15 minutes.'),  authController.register);
router.post('/login',           limiter(10, 'Too many attempts. Please try again in 15 minutes.'),  authController.login);
router.post('/refresh',         authController.refresh);
router.post('/logout',          authController.logout);
router.get('/me',               authenticate, authController.getMe);
// Password reset is admin-driven and out-of-band (no mail service): see
// POST /api/user/:id/reset-password. The emailed forgot/reset and the email-
// verification routes have been removed; registration auto-verifies.
// The OAuth routes below are left in place but are unreachable — the frontend
// no longer offers GitHub/Google sign-in.
router.get('/google', authController.googleAuth);
router.get('/google/callback', authController.googleCallback);
router.get('/github', authController.githubAuth);
router.get('/github/callback', authController.githubCallback);

// Invitation management — Admin and Bocal only
router.post('/invite', authenticate, requireRole('Admin', 'Bocal'), authController.createInvite);
router.get('/invites', authenticate, requireRole('Admin', 'Bocal'), authController.getInvites);
router.delete('/invite/:id', authenticate, requireRole('Admin', 'Bocal'), authController.revokeInvite);

module.exports = router;