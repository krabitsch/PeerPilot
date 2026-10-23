const { ConflictError, ValidationError } = require('@transcendence/errors')
const IMPOSSIBLE = 'Unable to generate all evaluation pairings without repeating evaluator/evaluee encounters. Reduce the number of required evaluation rounds or add more participating groups or eligible evaluators.'
const DUPLICATE = 'These groups already meet in another evaluation pairing for this assignment.'

// Group identity takes precedence; evaluator-only participants without a group
// have a distinct user identity. Never confuse a user ID with a group ID.
const encounterKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`
const evaluatorGroupId = (row, groups) => row.evaluatorGroupId ??
  groups.find(g => g.members.some(m => m.userId === row.evaluatorUserId))?.id ?? null
const keyFor = (row, groups) => {
  const groupId = evaluatorGroupId(row, groups)
  if (groupId === row.evalueeGroupId || groups.find(g => g.id === row.evalueeGroupId)
    ?.members.some(m => m.userId === row.evaluatorUserId)) {
    throw new ValidationError('A group cannot evaluate itself.')
  }
  return groupId == null ? `u${row.evaluatorUserId}:g${row.evalueeGroupId}` : encounterKey(groupId, row.evalueeGroupId)
}
// Cancelled pending work never took place and may be reallocated. Submitted
// attempts (including failed/retried attempts) reserve their encounter forever.
const countsAsEncounter = row => row.status !== 'Cancelled' || row.evalResponseId != null
const usedEncounters = (pairings, groups, strict = false) => {
  const used = new Set()
  for (const row of pairings.filter(countsAsEncounter)) {
    const key = keyFor(row, groups)
    if (strict && used.has(key)) throw new ConflictError(
      'Existing evaluation pairings repeat encounters. Cancel conflicting pending pairings before generating replacements; submitted feedback must be preserved.')
    used.add(key)
  }
  return used
}
const available = (slot, userId, groups, used) => !used.has(keyFor({
  evaluatorUserId: userId, evalueeGroupId: slot.groupId,
}, groups))

const validatePlan = (summary, slots, plan) => {
  const used = usedEncounters(summary.pairings, summary.groups, true)
  if (plan.length !== slots.length) throw new ValidationError(IMPOSSIBLE)
  const remaining = new Map(slots.map(s => [`${s.groupId}:${s.round}`, s]))
  for (const row of plan) {
    const slotId = `${row.evalueeGroupId}:${row.round}`
    const slot = remaining.get(slotId)
    if (!slot?.candidateIds.includes(row.evaluatorUserId)) throw new ValidationError(IMPOSSIBLE)
    const key = keyFor(row, summary.groups)
    if (used.has(key)) throw new ConflictError(DUPLICATE)
    used.add(key)
    remaining.delete(slotId)
  }
  if (remaining.size) throw new ValidationError(IMPOSSIBLE)
}

// Reuse the former seeded circular offsets, with the corrected unordered limit:
// shifts r and n-r are the same encounter; n/2 also reciprocates within a round.
const rotation = (assignment, summary, slots) => {
  if (summary.pairings.length || slots.length !== summary.groups.length * assignment.req_eval) return null
  const groups = [...summary.groups].sort((a, b) => a.id - b.id)
  if (!groups.length || groups.some(g => !g.eligible || !g.members.length) ||
      summary.participants.some(p => p.evaluatorEligible && !groups.some(g => g.members.some(m => m.userId === p.id)))) return null
  if (assignment.req_eval > Math.floor((groups.length - 1) / 2)) return null
  let seed = assignment.id % 2147483647
  if (seed <= 0) seed += 2147483646
  for (let i = groups.length - 1; i > 0; i--) {
    seed = seed * 16807 % 2147483647
    const j = Math.floor(((seed - 1) / 2147483646) * (i + 1))
    ;[groups[i], groups[j]] = [groups[j], groups[i]]
  }
  const plan = []
  const people = new Map(summary.participants.map(p => [p.id, { ...p }]))
  for (let round = 1; round <= assignment.req_eval; round++) {
    for (let i = 0; i < groups.length; i++) {
      const target = groups[i], source = groups[(i + round) % groups.length]
      const slot = slots.find(s => s.groupId === target.id && s.round === round)
      const candidates = source.members.map(m => people.get(m.userId)).filter(p => p && slot?.candidateIds.includes(p.id))
        .sort((a, b) => a.courseCount - b.courseCount || a.assignmentCount - b.assignmentCount || a.id - b.id)
      if (!candidates.length) return null
      const person = candidates[0]
      plan.push({ evalueeGroupId: target.id, evaluatorGroupId: source.id, evaluatorUserId: person.id, round })
      person.courseCount++; person.assignmentCount++
    }
  }
  return plan
}

const planPairings = (assignment, summary, slots) => {
  const used = usedEncounters(summary.pairings, summary.groups, true)
  const circular = rotation(assignment, summary, slots)
  if (circular) { validatePlan(summary, slots, circular); return circular }

  // Bipartite matching: required slots on the left, unordered encounters on the
  // right. An augmenting path can move earlier choices, so an unlucky greedy
  // ordering never causes a false failure or a relaxation of the constraints.
  // Evaluator users are NOT capacity-one: evaluator-only staff and uneven pools
  // retain their existing semantics. Workload is a preference, not a new quota.
  const people = new Map(summary.participants.map(p => [p.id, { ...p }]))
  const options = slots.map(slot => slot.candidateIds.map(userId => ({
    evalueeGroupId: slot.groupId, evaluatorUserId: userId,
    evaluatorGroupId: evaluatorGroupId({ evaluatorUserId: userId }, summary.groups), round: slot.round,
  })).filter(row => !used.has(keyFor(row, summary.groups))))
  if (new Set(options.flat().map(row => keyFor(row, summary.groups))).size < slots.length) {
    throw new ValidationError(IMPOSSIBLE)
  }
  const owners = new Map(), assigned = new Map()
  const move = (index, visited) => {
    const candidates = [...options[index]].sort((a, b) => {
      const x = people.get(a.evaluatorUserId), y = people.get(b.evaluatorUserId)
      return x.courseCount - y.courseCount || x.assignmentCount - y.assignmentCount || x.id - y.id
    })
    // Preserve earlier workload choices whenever a free encounter exists.
    candidates.sort((a, b) => Number(owners.has(keyFor(a, summary.groups))) - Number(owners.has(keyFor(b, summary.groups))))
    for (const row of candidates) {
      const key = keyFor(row, summary.groups)
      if (visited.has(key)) continue
      visited.add(key)
      const owner = owners.get(key)
      if (owner !== undefined && !move(owner, visited)) continue
      const previous = assigned.get(index)
      if (previous) {
        const person = people.get(previous.evaluatorUserId)
        person.courseCount--; person.assignmentCount--
      }
      const person = people.get(row.evaluatorUserId)
      person.courseCount++; person.assignmentCount++
      owners.set(key, index); assigned.set(index, row)
      return true
    }
    return false
  }
  const order = slots.map((_, i) => i).sort((a, b) => options[a].length - options[b].length || a - b)
  for (const index of order) if (!move(index, new Set())) throw new ValidationError(IMPOSSIBLE)
  const plan = slots.map((_, i) => assigned.get(i))
  validatePlan(summary, slots, plan)
  return plan
}
module.exports = { encounterKey, evaluatorGroupId, keyFor, countsAsEncounter, usedEncounters, available, validatePlan, planPairings, DUPLICATE, IMPOSSIBLE }
