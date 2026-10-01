// Saved sessions written by global-setup, one per role.
const path = require('path')
const fs = require('fs')

const ROLES_WITH_SESSIONS = ['admin', 'bocal', 'alice', 'bob', 'carol', 'dave']

const sessionFile = (role) => path.join(__dirname, '..', '.auth', `${role}.json`)

// IDs of the seeded rows, written by global-setup so tests never hardcode them.
const SEEDED_IDS = path.join(__dirname, '..', '.auth', 'seeded-ids.json')
const seeded = () => JSON.parse(fs.readFileSync(SEEDED_IDS, 'utf8'))

// The access token inside a saved session, for API tests.
const tokenFor = (role) => {
  const state = JSON.parse(fs.readFileSync(sessionFile(role), 'utf8'))
  return state.origins[0].localStorage.find((e) => e.name === 'access_token').value
}

module.exports = { ROLES_WITH_SESSIONS, sessionFile, tokenFor, SEEDED_IDS, seeded }
