const { test } = require('node:test')
const assert = require('node:assert/strict')

const { csvCell, csvRow, sanitize } = require('../src/modules/export/csv')

test('csvCell leaves plain values untouched', () => {
    assert.equal(csvCell('hello'), 'hello')
    assert.equal(csvCell(42), '42')
    assert.equal(csvCell(0), '0')
    assert.equal(csvCell(false), 'false')
})

test('csvCell renders null/undefined as empty', () => {
    assert.equal(csvCell(null), '')
    assert.equal(csvCell(undefined), '')
})

test('csvCell quotes fields with commas, quotes or newlines', () => {
    assert.equal(csvCell('a,b'), '"a,b"')
    assert.equal(csvCell('line1\nline2'), '"line1\nline2"')
    assert.equal(csvCell('say "hi"'), '"say ""hi"""')
    assert.equal(csvCell('carriage\rreturn'), '"carriage\rreturn"')
})

test('csvRow joins cells and quotes only where needed', () => {
    assert.equal(csvRow(['a', 'b,c', 'd']), 'a,"b,c",d')
    assert.equal(csvRow(['plain', 1, null]), 'plain,1,')
})

test('a malicious comment cannot break out of its cell', () => {
    // A comment with a comma and a quote stays one quoted field.
    const row = csvRow(['group', 'Great work, "A+"'])
    assert.equal(row, 'group,"Great work, ""A+"""')
})

test('sanitize strips path separators (zip-slip) and exotic characters', () => {
    assert.equal(sanitize('../../etc/passwd'), '.._.._etc_passwd')
    assert.equal(sanitize('a/b\\c'), 'a_b_c')
    assert.equal(sanitize('normal name.txt'), 'normal name.txt')
    assert.equal(sanitize('weird*:?<>|name'), 'weird______name')
})

test('sanitize falls back to "unnamed" for empty input', () => {
    assert.equal(sanitize(''), 'unnamed')
    assert.equal(sanitize(null), 'unnamed')
    assert.equal(sanitize('   '), 'unnamed')
})
