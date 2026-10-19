const {prisma} = require('@transcendence/database')
const {NotFoundError, ValidationError, ConflictError, UnauthorizedError} = require('@transcendence/errors')
const utils = require('@transcendence/utils')


const participation = require('../participation/service')
const groupInclude = {members:{include:{user:{select:{id:true,username:true,email:true}}}}}
const createGroupInTransaction = async (db, assignment, {userId,name,size}) => {
    userId=participation.positiveId(userId)
    size=participation.positiveId(size)
    if (typeof name!=='string'||!name.trim()) throw new ValidationError('Group name is required')
    await participation.assertEvaluee(db,assignment,userId)
    if(await db.groupMember.findFirst({where:{userId,group:{assId:assignment.id}}}))
        throw new ConflictError('User is already a member of a group for this assignment')
    if(await db.group.findFirst({where:{assId:assignment.id,name:name.trim()}}))
        throw new ConflictError('Group name exists already')
    return db.group.create({data:{assId:assignment.id,name:name.trim(),size,leaderId:userId,
        members:{create:{userId}}},include:groupInclude})
}
const createGroup = (payload,actor) => participation.withAssignment(payload.assId,actor,
    (db,a)=>createGroupInTransaction(db,a,payload))
const generateGroups = (id,actor) => participation.withAssignment(id,actor,async(db,a)=>{
    const participants=await participation.participantsFor(db,a)
    const groups=await db.group.findMany({where:{assId:a.id},include:{members:true}})
    const grouped=new Set(groups.flatMap(g=>g.members.map(m=>m.userId)))
    const people=participants.filter(p=>p.evalueeEligible&&!grouped.has(p.id)).sort((a,b)=>a.id-b.id)
    const size=participation.positiveId(a.groupSize)
    const names=new Set(groups.map(g=>g.name.toLowerCase()))
    let index=1
    for(let i=0;i<people.length;i+=size){
        while(names.has(`group${index}`)) index++
        const name=`group${index++}`;names.add(name)
        const chunk=people.slice(i,i+size)
        await db.group.create({data:{assId:a.id,name,size,leaderId:chunk[0].id,
            members:{create:chunk.map(p=>({userId:p.id}))}}})
    }
    return db.group.findMany({where:{assId:a.id},orderBy:{id:'asc'},include:groupInclude})
})

const inviteMember = async (groupId, {leaderId, inviteeId})=>{

    if(!groupId || !leaderId || !inviteeId )
        throw new ValidationError('Invalid request')
    if(parseInt(leaderId) == parseInt(inviteeId))
        throw new ConflictError('WTF bro')

    const user = await utils.getUserById(leaderId)
    if(!user)
        throw new NotFoundError("User Not Found")
    const inviteeUser = await utils.getUserById(inviteeId)
    if(!inviteeUser)
        throw new ConflictError("Invetee user not found")

    const group = await utils.getGroupById(groupId, null, {assignment: true})
    if(!group)
        throw new NotFoundError("Group not found")
    const targetClass = group.assignment.classid
    const inviteeAcEnr = await utils.isEnrolledAndActive(inviteeId, targetClass)
    if(!inviteeAcEnr)
        throw new ConflictError('Invitee is not enrolled or active for this class')
    if(group.leaderId !== parseInt(leaderId))
        throw new ConflictError("User is not allowed to invite")
    const memeberCount = await utils.getGroupCurrentCount(groupId)
    if(memeberCount >= group.size)
        throw new ConflictError("Group is already full")

    const alreadyInvited = await utils.isAlreadyInvited(inviteeId, groupId)
    if(alreadyInvited)
        throw new ConflictError('Invitee is already invited')

    return await prisma.groupInvite.create({
        data:{senderId: parseInt(leaderId), reciverId: parseInt(inviteeId),
            targetGroupId: parseInt(groupId), status: 'Pending'
        }
    })
}

// add member to an existing group (as bocal)
const addMemberAdmin = async (groupId, {userId}, actor) => {
    const group=await prisma.group.findUnique({where:{id:participation.positiveId(groupId)}})
    if(!group) throw new NotFoundError('Group not found')
    return participation.withAssignment(group.assId,actor,async(db,a)=>{
        userId=participation.positiveId(userId)
        await participation.assertEvaluee(db,a,userId)
        if(await db.groupMember.findFirst({where:{userId,group:{assId:a.id}}}))
            throw new ConflictError('User is already a member of a group for this assignment')
        if(await db.evalAssignment.findFirst({where:{evalueeGroupId:group.id,evaluatorUserId:userId,status:{not:'Cancelled'}}}))
            throw new ConflictError('This participant evaluates this group and cannot become its evaluee')
        await db.groupMember.create({data:{userId,groupId:group.id}})
        const count=await db.groupMember.count({where:{groupId:group.id}})
        if(count>group.size) await db.group.update({where:{id:group.id},data:{size:count}})
        return db.group.findUnique({where:{id:group.id},include:groupInclude})
    })
}

const removeMemberAdmin = async (groupId, { userId }) => {
    if (!groupId || !userId)
        throw new ValidationError('Invalid request')

    const group = await utils.getGroupById(groupId, null, {
        members: {
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true } } } } })
    if (!group)
        throw new NotFoundError('Group not found')
    const userIdInt = parseInt(userId)
    const groupIdInt = parseInt(groupId)
    const memberToRemove = group.members.find(member => member.userId === userIdInt)
    if (!memberToRemove)
        throw new ConflictError('User is not a member of this group')
    if (group.members.length <= 1)
        throw new ConflictError('Cannot remove the last member of a group. Remove the whole group instead.')
    await prisma.groupMember.delete({ where: { userId_groupId: { userId: userIdInt, groupId: groupIdInt }}})

    if (group.leaderId === userIdInt) {
        const newLeader = group.members.find(member => member.userId !== userIdInt)
        if (!newLeader)
            throw new ConflictError('Could not assign a new group leader')
        await prisma.group.update({ where: { id: groupIdInt }, data: { leaderId: newLeader.userId } })
    }
    const memberCount = await utils.getGroupCurrentCount(groupId)
    await prisma.group.update({ where: { id: groupIdInt }, data: { size: memberCount } })
    return await prisma.group.findUnique({
        where: { id: groupIdInt },
        include: {
            members: {
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true } } } } } })
}

//get the group profile
const getGroup = async(groupId)=>{
    if(!groupId)
        throw new ValidationError('Invalid request')

    const group = await utils.getGroupById(groupId, null, {members: {include: {user: true}}})
    if(!group)
        throw new NotFoundError('Group not found')
    return group
}

//gets the invite
const getInvites = async({userId})=>{
    if(!userId)
        throw new ValidationError('Invalid request')
    const invites = await prisma.groupInvite.findMany({
        where:{reciverId: parseInt(userId), status: 'Pending'},
        include:{targetGroup: true, senderUser: true}
    })
    return invites
}

const leaveGroup = async(groupId, {userId})=>{
    if(!groupId || !userId)
        throw new ValidationError('Invalid request')

    const group = await utils.getGroupById(groupId)
    if(!group)
        throw new NotFoundError('Group not found')
    const isMemeber = await utils.existingMembership(userId, group.assId)
    if(!isMemeber)
        throw new ConflictError('User is not a member of this group')
    if(group.leaderId === parseInt(userId))
        throw new ConflictError('Group leader cannot leave the group')
    await prisma.groupMember.delete({
        where:{userId_groupId: {userId: parseInt(userId), groupId: parseInt(groupId)}}
    })
    return {message: 'Left the group successfully'}
}

const deleteInvite = async(inviteId, userId)=>{
    if(!inviteId || !userId)
        throw new ValidationError('Invalid request')
    const invite = await utils.getinvite(inviteId)
    if(!invite)
        throw new NotFoundError('Invite Not Found')

    // Either side of an invite may cancel it: the leader who sent it, or the
    // student who received it. Nobody else gets to touch it.
    const requesterId = parseInt(userId)
    if(invite.senderId !== requesterId && invite.reciverId !== requesterId)
        throw new UnauthorizedError('This invite is not yours to delete')

    await prisma.groupInvite.delete({
        where:{id: parseInt(inviteId)}
    })
    return {message: 'Invite deleted successfully'}
}
    
const respondToInvite = async(inviteId, {userId, status})=>{
    if(!inviteId || !userId || !status)
        throw new ConflictError('Invalid request')
    if(status === 'Pending')
        throw new ConflictError('Invalid request')

    const invite = await utils.getinvite(inviteId)
    if(!invite)
        throw new NotFoundError('Invite Not Found')
    if(invite.status !== 'Pending')
        throw new ConflictError('Invalid invite')

    const user = await utils.getUserById(userId)
    if(!user)
        throw new NotFoundError('User not found')
    if(invite.reciverId !== parseInt(userId))
        throw new ConflictError('invite error')

    const updatedinvite = await prisma.groupInvite.update({
        where:{id: parseInt(inviteId)},
        data:{status},
        include:{targetGroup: true}
    })
    if(status === 'Accepted')
    {
        await prisma.groupMember.create({
            data:{userId: invite.reciverId, groupId: invite.targetGroupId}
        })
    }
    return {
        message: status == 'Accepted' ? 'Invite accepted successfully'
        :'invite declined successfully',
        invite: updatedinvite,
        group:updatedinvite.targetGroup
    }
}

//list all groups for an assignment (staff management)
const getGroupsForAssignment = async (assId)=>{
    if(!assId)
        throw new ValidationError('Invalid request')

    const assignment = await utils.getAssignmentById(assId)
    if(!assignment)
        throw new NotFoundError('Assignment not found')

    return await prisma.group.findMany({
        where: {assId: parseInt(assId)},
        include: {members: {include: {user: {select: {id: true, username: true, email: true}}}}}
    })
}

// Never cascade-delete an evaluee's submission or evaluation history.
const deleteGroup = async (groupId, actor) => {
    const id=participation.positiveId(groupId)
    const group=await prisma.group.findUnique({where:{id}})
    if(!group) throw new NotFoundError('Group not found')
    return participation.withAssignment(group.assId,actor,async(db)=>{
        const current=await db.group.findUnique({where:{id},include:{_count:{select:{submissions:true,evalAssignmentsAsEvaluee:true}}}})
        if(!current) throw new NotFoundError('Group not found')
        if(current._count.submissions || current._count.evalAssignmentsAsEvaluee)
            throw new ConflictError('This group has submission or evaluation history and cannot be deleted. Its existing records must be preserved.')
        await db.group.delete({where:{id}})
        return {message:'Group deleted successfully',id}
    })
}

const getMyGroupForAssignment = async ({ userId, assId }) => {
    if (!userId || !assId)
        throw new ValidationError('Invalid request')
    const membership = await utils.existingMembership(userId, assId, {
        group: {
            include: {
                members: { include: { user: true } }
            }
        }
    })
    return membership?.group ?? null
}

module.exports = {createGroup, generateGroups, inviteMember, addMemberAdmin, removeMemberAdmin, respondToInvite, getGroup, leaveGroup,
    deleteInvite, getInvites, getMyGroupForAssignment, getGroupsForAssignment, deleteGroup}
  