const { prisma } = require('@transcendence/database')
const { verifyAccessToken } = require('../modules/auth/utils')
const { UnauthorizedError, ForbiddenError } = require('@transcendence/errors')

// Verifies the bearer token and loads the caller's current role.
//
// The role comes from the database on every request rather than from the token:
// access tokens live for 15 minutes, so a role change (or a deleted account)
// would otherwise keep working until the token expired.
const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(new UnauthorizedError('Missing or invalid token'))
    }

    const token = authHeader.split(' ')[1]

    let payload
    try {
        payload = verifyAccessToken(token)
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return next(new UnauthorizedError('Token expired'))
        }
        return next(new ForbiddenError('Invalid token'))
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: parseInt(payload.userId) },
            select: { id: true, email: true, role: true, orgId: true }
        })
        if (!user) {
            return next(new UnauthorizedError('Account no longer exists'))
        }

        req.user = { userId: user.id, email: user.email, role: user.role, orgId: user.orgId }
        next()
    } catch (err) {
        next(err)
    }
}

const STAFF_ROLES = ['Admin', 'Bocal']

const isStaff = (req) => !!req.user && STAFF_ROLES.includes(req.user.role)

// Restricts a route to the given roles. `authenticate` must run first.
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) return next(new UnauthorizedError('Not authenticated'))
    if (!roles.includes(req.user.role)) {
        return next(new ForbiddenError('Insufficient permissions'))
    }
    next()
}

const requireStaff = requireRole(...STAFF_ROLES)

// Restricts a route to the user it names, with staff allowed through.
// `param` is the route parameter holding the target user id, e.g. '/user/:id'.
const requireSelfOrStaff = (param = 'id') => (req, res, next) => {
    if (!req.user) return next(new UnauthorizedError('Not authenticated'))
    if (isStaff(req)) return next()
    if (parseInt(req.params[param], 10) === req.user.userId) return next()
    next(new ForbiddenError('You can only act on your own account'))
}

module.exports = {
    authenticate,
    requireRole,
    requireStaff,
    requireSelfOrStaff,
    isStaff,
    STAFF_ROLES
}
