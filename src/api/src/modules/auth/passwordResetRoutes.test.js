const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm')
const express = require('express')
const rateLimit = require('express-rate-limit')
const { MESSAGE } = require('./passwordResetService')

test('forgot-password limits both IP and normalized email with the same generic response', async () => {
  let requests = 0
  const router = express.Router()
  const noop = (_req, _res, next) => next()
  vm.runInNewContext(fs.readFileSync(__dirname + '/routes.js', 'utf8'), {
    module: { exports: {} }, process: { env: {} }, require: name => {
      if (name === 'express') return { Router: () => router }
      if (name === 'express-rate-limit') return rateLimit
      if (name === 'crypto') return require('crypto')
      if (name === './passwordResetService') return { MESSAGE }
      if (name === './passwordResetController') return {
        request: (_req, res) => { requests++; res.json({ message: MESSAGE }) }, validate: noop, redeem: noop,
      }
      if (name === './controller') return new Proxy({}, { get: () => noop })
      if (name === '../../middleware/authenticate') return { authenticate: noop, requireRole: () => noop }
      throw Error(name)
    },
  })
  const app = express(); app.use(express.json()); app.use(router)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}/forgot-password`
    for (const email of ['student@example.com', ' STUDENT@EXAMPLE.COM ', 'student@example.com', 'student@example.com', 'other@example.com', 'third@example.com']) {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
      assert.equal(res.status, 200); assert.deepEqual(await res.json(), { message: MESSAGE })
    }
    // Email's fourth attempt and IP's sixth attempt never reach the controller.
    assert.equal(requests, 4)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
