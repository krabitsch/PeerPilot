// Runs once before the suite: reseed the database, then log each role in
// through the API and save the session for tests to reuse.
//
// The frontend keeps its access token in localStorage and restores a session
// from it on load, so a saved session is that token plus the refresh cookie.
// Logging in once per role instead of once per test keeps the run fast and
// well inside the auth rate limit.
const fs = require('fs')
const path = require('path')
const { request } = require('@playwright/test')
const { seed } = require('./support/seed')
const { db } = require('./support/db')
const { BASE_URL } = require('./support/env')
const { sessionFile, ROLES_WITH_SESSIONS, SEEDED_IDS } = require('./support/sessions')
const D = require('./support/data')

module.exports = async () => {
  const ids = await seed()
  await db().$disconnect()

  fs.mkdirSync(path.dirname(sessionFile('x')), { recursive: true })
  fs.writeFileSync(SEEDED_IDS, JSON.stringify(ids, null, 2))
  for (const role of ROLES_WITH_SESSIONS) {
    const ctx = await request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
    const res = await ctx.post('/api/auth/login', { data: { email: D.users[role].email, password: D.PASSWORD } })
    const body = await res.json()
    if (!body.accessToken) throw new Error(`Could not log in as ${role}: ${JSON.stringify(body)}`)

    const state = await ctx.storageState()
    state.origins = [{
      origin: BASE_URL,
      localStorage: [
        { name: 'access_token', value: body.accessToken },
        { name: 'language', value: 'en' },
      ],
    }]
    fs.writeFileSync(sessionFile(role), JSON.stringify(state, null, 2))
    await ctx.dispose()
  }
}
