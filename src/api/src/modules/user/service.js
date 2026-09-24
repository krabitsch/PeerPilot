const { prisma } = require('@transcendence/database')
const { NotFoundError, ValidationError } = require('@transcendence/errors')
const utils = require('@transcendence/utils')
const logger = require('@transcendence/logger')
const {createStorage} = require('@transcendence/filemanager')

let storage
(async () => {
  storage = createStorage('user-profile')
  await storage.ensureBucket()
  await storage.makePublic()
})().catch(err => logger.error('Failed to initialize storage:', err))

//const url = storage.getPublicUrl(fileName)


const uploadAvatar = async (userId, reqFile) => {
  if (!userId || !reqFile)
    throw new ValidationError('Invalid request')
  
  const user = await utils.getUserById(userId)
  if (!user)
    throw new NotFoundError('User not found')

  const fileName = `avatar-${userId}-${Date.now()}-${reqFile.originalname}`
  await storage.upload(fileName, reqFile.buffer, reqFile.mimetype, reqFile.size)
  const publicUrl = storage.getPublicUrl(fileName)

  // save the url to user profile
  const profile = await prisma.userProfile.upsert({
    where:  { userId: parseInt(userId) },
    update: { avatar: publicUrl, last_update: new Date() },
    create: { userId: parseInt(userId), avatar: publicUrl, bio: '', last_update: new Date() },
  })

  return profile
}

// Deliberately no email: this endpoint is readable by every authenticated
// user, and the screens that legitimately need contact details read them from
// the org-members and class-students endpoints instead.
const getAllUsers = async () => {
  const select = { id: true, username: true, created_at: true }
  return await utils.getAllUsers(select)
}

const getUserById = async (id) => {
  const select = {id: true, email: true, username: true, created_at: true }
  const user = await utils.getUserById(id, select)
  if (!user) throw new NotFoundError('User not found')
  return user
}


//Havent tested it yet
const getRole = async (id) => {
  const select = { id: true, role: true }
  const user = await utils.getUserById(id, select)
  if (!user) 
    throw new NotFoundError('User not found')
  return { role: user.role }
}


const getProfile = async (id)=>{
  const profile = await utils.getUserProfile(id)
  if(!profile) throw new NotFoundError('Profile not found')
  return profile;
}

const updateProfile = async (id, bio)=>{
  const profile = await prisma.userProfile.upsert({
    where: {userId: parseInt(id)},
    update: {bio, last_update: new Date()},
    create: {userId: parseInt(id), bio, last_update: new Date()}
  })
  return profile;
}

const deleteUser = async (id)=>{
  const user = await utils.getUserById(id)
  if(!user) throw new NotFoundError('User not found')
  await prisma.user.delete({where: {id: parseInt(id)}})

  return{
      message: 'User deleted successfully',
      userId: parseInt(id)
  }
}


module.exports = { getAllUsers, getUserById, getRole, getProfile, updateProfile, deleteUser, uploadAvatar}