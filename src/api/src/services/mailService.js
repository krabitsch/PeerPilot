const nodemailer = require('nodemailer')
const logger = require('@transcendence/logger')

// Transport is shared with future mail types. SMTP is allowed locally too.
const sendMail = async message => {
  const mode = process.env.EMAIL_TRANSPORT || 'smtp'
  let options
  if (mode === 'json') {
    options = { jsonTransport: true }
  } else if (mode === 'smtp') {
    const port = Number(process.env.EMAIL_PORT || 587)
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_FROM || !Number.isInteger(port) || port < 1)
      throw new Error('Mail configuration is incomplete')
    options = {
      host: process.env.EMAIL_HOST, port,
      secure: process.env.EMAIL_SECURE === 'true',
      ...(process.env.EMAIL_USER ? { auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } } : {}),
    }
  } else {
    throw new Error('Unsupported mail transport')
  }
  const result = await nodemailer.createTransport(options).sendMail({
    from: process.env.EMAIL_FROM || 'Peerofessor <no-reply@example.invalid>', ...message,
  })
  if (mode === 'json') logger.info('mail', 'Development email (JSON transport; no delivery)', { email: result.message })
  else if (!result.accepted?.length || result.rejected?.length) throw new Error('Mail was not accepted')
}

const sendInvitationEmail = ({ email, url, hours }) => sendMail({
  to: email,
  subject: "You're invited to Peerofessor",
  text: `You have been invited to create a Peerofessor account.\n\nUse the link below to set your password and activate your account:\n\n${url}\n\nThis invitation link expires in ${hours / 24 === 7 ? '7 days' : `${hours} hours`}.\n\nIf you were not expecting this invitation, you can ignore this email.`,
})
module.exports = { sendInvitationEmail }
