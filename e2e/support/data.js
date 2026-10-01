// The fixed dataset every run starts from. Tests refer to these constants
// instead of repeating names, so a change here shows up everywhere.

const PASSWORD = 'E2e-Passw0rd!'

const users = {
  admin:      { email: 'admin@e2e.test',      username: 'e2e_admin',  role: 'Admin' },
  bocal:      { email: 'bocal@e2e.test',      username: 'e2e_bocal',  role: 'Bocal' },
  alice:      { email: 'alice@e2e.test',      username: 'alice',      role: 'Student' }, // runs the submission journey
  bob:        { email: 'bob@e2e.test',        username: 'bob',        role: 'Student' },
  carol:      { email: 'carol@e2e.test',      username: 'carol',      role: 'Student' }, // leads the group that gets evaluated
  dave:       { email: 'dave@e2e.test',       username: 'dave',       role: 'Student' }, // evaluates carol's group
  unverified: { email: 'unverified@e2e.test', username: 'unverified', role: 'Student', verified: false },
}

const org = { email: 'org@e2e.test', name: 'E2E Academy', tag: 'E2E' }

const classes = {
  web:  { name: 'Web Fundamentals', description: 'Class every seeded student is enrolled in.' },
  open: { name: 'Open Class',       description: 'Class nobody is enrolled in.' },
}

const evalSheet = [
  { name: 'Functionality', description: 'Does it work?', marks: 60, sectionType: 'Slider' },
  { name: 'Code quality',  description: 'Is it readable?', marks: 40, sectionType: 'Toggle' },
]

const assignments = {
  solo: { name: 'Solo Project', description: 'Alice starts, uploads and closes a submission here.' },
  peer: { name: 'Peer Review',  description: 'Carol has submitted; Dave is assigned to evaluate her.' },
}

const PASSKEY = '424242'

// An invited address that has not registered yet.
const invite = { email: 'newbie@e2e.test', password: 'Correct-Horse-Battery-42' }

module.exports = { PASSWORD, users, org, classes, evalSheet, assignments, PASSKEY, invite }
