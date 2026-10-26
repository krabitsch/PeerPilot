const normalizeEmail = email => String(email ?? '').trim().toLowerCase()
const invitationStatus = (entry, registered = false) => {
  if (registered) return 'Registered'
  if (!entry?.invite_token_expiry) return 'Not invited'
  if (new Date(entry.invite_token_expiry) <= new Date()) return 'Invitation expired'
  return entry.invite_sent_at ? 'Invitation sent' : 'Not invited'
}
module.exports = { normalizeEmail, invitationStatus }
