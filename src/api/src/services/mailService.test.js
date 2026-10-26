const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function harness(env, result = { accepted: ['student@example.com'], rejected: [] }) {
  const transports = [], messages = [], logs = []
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(__dirname + '/mailService.js', 'utf8'), {
    module, process: { env }, require: name => {
      if (name === 'nodemailer') return { createTransport: options => {
        transports.push(options)
        return { sendMail: async message => {
          messages.push(message)
          return options.jsonTransport ? { message: JSON.stringify(message) } : result
        } }
      } }
      if (name === '@transcendence/logger') return { info: (...args) => logs.push(args) }
      throw Error(name)
    },
  })
  return { service: module.exports, transports, messages, logs }
}
const invitation = { email: 'student@example.com', url: 'http://localhost:4200/register?token=secret', hours: 168 }
test('JSON transport only builds mail and makes the invitation visible in development logs', async () => {
  const h = harness({ EMAIL_TRANSPORT: 'json', EMAIL_HOST: 'must-not-connect' })
  await h.service.sendInvitationEmail(invitation)
  assert.deepEqual(JSON.parse(JSON.stringify(h.transports)), [{ jsonTransport: true }])
  assert.match(h.messages[0].text, /expires in 7 days/)
  assert.ok(JSON.stringify(h.logs).includes(invitation.url))
})
test('SMTP works in local development and does not log the invitation or credentials', async () => {
  const h = harness({ EMAIL_TRANSPORT: 'smtp', NODE_ENV: 'development', EMAIL_HOST: 'smtp.example.com',
    EMAIL_PORT: '465', EMAIL_SECURE: 'true', EMAIL_FROM: 'Course <course@example.com>', EMAIL_USER: 'user', EMAIL_PASS: 'password' })
  await h.service.sendInvitationEmail(invitation)
  assert.equal(h.transports[0].secure, true)
  assert.equal(h.transports[0].auth.pass, 'password')
  assert.equal(h.messages[0].to, invitation.email)
  assert.equal(h.logs.length, 0)
})
test('SMTP rejection and incomplete configuration fail rather than reporting delivery', async () => {
  const h = harness({ EMAIL_TRANSPORT: 'smtp', EMAIL_HOST: 'smtp.example.com', EMAIL_FROM: 'course@example.com' }, { accepted: [], rejected: ['student@example.com'] })
  await assert.rejects(h.service.sendInvitationEmail(invitation))
  await assert.rejects(harness({ EMAIL_TRANSPORT: 'smtp' }).service.sendInvitationEmail(invitation))
  await assert.rejects(harness({ EMAIL_TRANSPORT: 'unknown' }).service.sendInvitationEmail(invitation))
})
