// A group with a submission or a real evaluation pairing carries course history.
// Deleting it, or removing a member from it, cuts students off from their
// submission and evaluations: the database cascades a group deletion to the
// submission, its pairings and the evaluations received. Every path that
// removes groups or group members checks this first.
const protectedPairing={OR:[{status:{not:'Cancelled'}},{evalResponseId:{not:null}},{submissionId:{not:null}}]}
const historyCounts={_count:{select:{submissions:true,
    evalAssignmentsAsEvaluee:{where:protectedPairing},evalAssignmentsAsEvaluatorGroup:{where:protectedPairing}}}}
const hasHistory=group=>{
    const count=group?._count??{}
    return !!(count.submissions||count.evalAssignmentsAsEvaluee||count.evalAssignmentsAsEvaluatorGroup)
}
// Locks the group row before reading its history. A new submission's foreign key
// needs a share lock on that row, so no history can appear between this check
// and the caller's change in the same transaction.
const lockedHistory=async(db,groupId)=>{
    await db.$queryRaw`SELECT id FROM "group" WHERE id = ${groupId} FOR UPDATE`
    return db.group.findUnique({where:{id:groupId},include:historyCounts})
}
const HISTORY_MESSAGE='This group has submission or evaluation history and cannot be deleted. Its existing records must be preserved.'
const MEMBER_HISTORY_MESSAGE='This group has submission or evaluation history, so its members can no longer change. Removing someone would cut them off from their submission and evaluations.'

module.exports={protectedPairing,historyCounts,hasHistory,lockedHistory,HISTORY_MESSAGE,MEMBER_HISTORY_MESSAGE}
