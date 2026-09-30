// Prints a compact terminal summary of the last Playwright run, read from the
// JSON report the config writes to test-results/results.json. No browser, no
// re-run. `make e2e-summary`, or `node support/summary.js`.
const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'test-results', 'results.json')

if (!fs.existsSync(FILE)) {
  console.error('No results found. Run the suite first: `make e2e` (or `npx playwright test`).')
  process.exit(1)
}

const report = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const s = report.stats || {}

// Walk the suite tree and collect the specs that did not pass, with their file.
const failures = []
const walk = (suite, file) => {
  const f = suite.file || file
  for (const spec of suite.specs || []) {
    if (spec.ok === false) failures.push({ title: spec.title, file: f, line: spec.line })
  }
  for (const child of suite.suites || []) walk(child, f)
}
for (const suite of report.suites || []) walk(suite)

const passed = s.expected ?? 0
const failed = s.unexpected ?? failures.length
const flaky = s.flaky ?? 0
const skipped = s.skipped ?? 0
const total = passed + failed + flaky + skipped
const secs = s.duration != null ? (s.duration / 1000).toFixed(1) + 's' : '?'
const when = s.startTime ? new Date(s.startTime).toLocaleString() : 'unknown time'

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', RESET = '\x1b[0m'
const line = (label, n, colour) => n > 0 ? `${colour}${n} ${label}${RESET}` : `${DIM}0 ${label}${RESET}`

console.log(`\n  Playwright — ${total} tests in ${secs}  ${DIM}(${when})${RESET}`)
console.log('  ' + [
  line('passed', passed, GREEN),
  line('failed', failed, RED),
  line('flaky', flaky, YELLOW),
  line('skipped', skipped, DIM),
].join('   '))

if (failures.length) {
  console.log(`\n  ${RED}Failed:${RESET}`)
  for (const f of failures) {
    const loc = f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : ''
    console.log(`    ${RED}✘${RESET} ${f.title}  ${DIM}${loc}${RESET}`)
  }
}
console.log()
process.exit(failed > 0 ? 1 : 0)
