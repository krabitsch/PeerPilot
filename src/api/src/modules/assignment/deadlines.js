const { ValidationError } = require('@transcendence/errors')

const deadlinePassed = (deadline, now = Date.now()) => !!deadline && now > new Date(deadline).getTime()
const assertDeadline = (assignment, kind, now = Date.now()) => {
  if (deadlinePassed(assignment?.[`${kind}Deadline`], now))
    throw new ValidationError(`The ${kind === 'submission' ? 'submission' : 'peer-evaluation'} deadline has passed.`)
}

// Multipart forms clear optional values with an empty string. Omitted fields stay unchanged.
const assignmentDeadlines = (input, current = {}) => {
  const result = {}
  for (const key of ['submissionDeadline', 'evaluationDeadline']) {
    if (input[key] === undefined) continue
    const value = input[key]
    if (value === null || value === '') { result[key] = null; continue }
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))
      throw new ValidationError('Deadlines must be valid timestamps with a timezone.')
    result[key] = new Date(value)
  }
  const merged = { ...current, ...result }
  if (merged.submissionDeadline && merged.evaluationDeadline &&
      new Date(merged.evaluationDeadline) < new Date(merged.submissionDeadline))
    throw new ValidationError('Peer-evaluation deadline must be on or after the submission deadline.')
  return result
}
module.exports = { deadlinePassed, assertDeadline, assignmentDeadlines }
