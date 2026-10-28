// The e2e mail sink. With EMAIL_TRANSPORT=json the API delivers nothing and logs
// each email as one JSON line instead; tests read those lines and follow the
// links in them, exactly as a person would click the link in their inbox.
const { spawnSync } = require('child_process')
const { request } = require('@playwright/test')
const { BASE_URL } = require('./env')
const { tokenFor } = require('./sessions')

const API_CONTAINER = process.env.E2E_API_CONTAINER || 'e2e-api'

const sentMail = () => {
  const run = spawnSync('docker', ['logs', API_CONTAINER], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) throw new Error(`Cannot read the mail sink (docker logs ${API_CONTAINER}): ${run.stderr}`)
  const mails = []
  for (const line of `${run.stdout}\n${run.stderr}`.split('\n')) {
    if (!line.includes('"service":"mail"')) continue
    try {
      const mail = JSON.parse(JSON.parse(line).data.email)
      mails.push({ to: mail.to.map(t => t.address.toLowerCase()), subject: mail.subject, text: mail.text })
    } catch { /* not a mail line */ }
  }
  return mails
}

// The newest email sent to `address`, or undefined.
const lastMailTo = (address) => sentMail().filter(m => m.to.includes(address.toLowerCase())).pop()

// Path + query of the newest link to `path` (e.g. '/register') mailed to `address`.
const mailedLink = (address, path) => {
  const mail = lastMailTo(address)
  if (!mail) throw new Error(`No email was sent to ${address}`)
  const url = mail.text.match(/https?:\/\/\S+/g)?.map(u => new URL(u)).find(u => u.pathname === path)
  if (!url) throw new Error(`The last email to ${address} ("${mail.subject}") has no ${path} link`)
  return url.pathname + url.search
}

// Sends the invitation for an already whitelisted address, as `role` would from
// the admin or Bocal panel, and returns the /register link from that email.
const sendInvitation = async (address, role = 'admin') => {
  const api = await request.newContext({ baseURL: `${BASE_URL}/api/`, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: `Bearer ${tokenFor(role)}` } })
  try {
    const invite = (await (await api.get('auth/invites')).json()).find(i => i.email === address)
    if (!invite) throw new Error(`${address} is not whitelisted`)
    const res = await api.post(`auth/invite/${invite.id}/send`, { data: {} })
    const body = await res.json()
    if (!res.ok() || body.ok === false) throw new Error(`Sending the invitation to ${address} failed: ${JSON.stringify(body)}`)
  } finally { await api.dispose() }
  return mailedLink(address, '/register')
}

module.exports = { sentMail, lastMailTo, mailedLink, sendInvitation }
