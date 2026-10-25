const { prisma } = require('@transcendence/database')
const { ValidationError, NotFoundError } = require('@transcendence/errors')
const orderBy = [{ sortOrder: 'asc' }, { id: 'asc' }]
const numericMarks = value => value == null || value === '' ? NaN : Number(value)
const fields = row => {
  if (typeof row.name !== 'string' || !row.name.trim() || typeof row.description !== 'string' || !row.description.trim() ||
      !Number.isInteger(row.marks) || (row.marks < 0 || row.marks > 100) || !['Toggle','Slider'].includes(row.sectionType) ||
      (row.isBonus !== undefined && typeof row.isBonus !== 'boolean')) throw new ValidationError('Invalid evaluation section')
  return { name: row.name, description: row.description, marks: row.marks, sectionType: row.sectionType, isBonus: row.isBonus ?? false }
}
const withSheet = (id, action) => prisma.$transaction(async db => {
  const sheetId = Number(id)
  if (!Number.isSafeInteger(sheetId) || sheetId <= 0) throw new ValidationError('Invalid eval sheet ID')
  await db.$queryRaw`SELECT id FROM "evalSheet" WHERE id = ${sheetId} FOR UPDATE`
  const sheet = await db.evalSheet.findUnique({where:{id:sheetId},include:{assignment:true,sections:{orderBy}}})
  if (!sheet) throw new NotFoundError('Eval sheet not found')
  return action(db,sheet)
})
const normalize = async (db, rows) => {
  for (const [sortOrder,row] of rows.entries()) {
    if (row.sortOrder !== sortOrder) await db.evalSection.update({where:{id:row.id},data:{sortOrder}})
  }
}
const position = (value, max) => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new ValidationError('Invalid section sort order')
  return value
}
const createSection = (id, payload) => withSheet(id, async (db,sheet) => {
  const data = fields({...payload,marks:numericMarks(payload.marks)})
  const index = payload.sortOrder === undefined ? sheet.sections.length : position(payload.sortOrder,sheet.sections.length)
  const row = await db.evalSection.create({data:{...data,evalSheetId:sheet.id,sortOrder:index}})
  const rows=[...sheet.sections];rows.splice(index,0,row);await normalize(db,rows)
  return row
})
const updateSection = (id,payload) => withSheet(id, async (db,sheet) => {
  // The existing PATCH endpoint also accepts a complete ordered rubric on Save.
  // This avoids interleaved create/update/delete requests losing the chosen order.
  if (payload.sections !== undefined) {
    if (!Array.isArray(payload.sections) || !payload.sections.length) throw new ValidationError('Add core evaluation sections')
    const ids = new Set()
    const rows=payload.sections.map((row,sortOrder)=>{
      const data=fields(row)
      if (row.id != null) {
        if (!sheet.sections.some(s=>s.id===row.id) || ids.has(row.id)) throw new ValidationError('Invalid or duplicate evaluation section ID')
        ids.add(row.id)
      }
      return {id:row.id,...data,sortOrder}
    })
    if (rows.filter(s=>!s.isBonus).reduce((n,s)=>n+s.marks,0) !== sheet.assignment.max_score)
      throw new ValidationError('Core section marks must sum exactly to the assignment maximum; bonus points do not count toward this total.')
    for (const row of sheet.sections) if (!ids.has(row.id)) await db.evalSection.delete({where:{id:row.id}})
    for (const {id,...data} of rows) {
      if (id != null) await db.evalSection.update({where:{id},data})
      else await db.evalSection.create({data:{...data,evalSheetId:sheet.id}})
    }
    return db.evalSheet.findUnique({where:{id:sheet.id},include:{sections:{orderBy}}})
  }
  const index=sheet.sections.findIndex(s=>s.id===Number(payload.secId))
  if (index<0) throw new NotFoundError('Section not found')
  const current=sheet.sections[index]
  const data=fields({...current,...payload,marks:payload.marks===undefined?current.marks:numericMarks(payload.marks)})
  const row=await db.evalSection.update({where:{id:current.id},data})
  const rows=sheet.sections.filter(s=>s.id!==current.id)
  const next=payload.sortOrder===undefined?index:position(payload.sortOrder,rows.length)
  rows.splice(next,0,row);await normalize(db,rows)
  return {...row,sortOrder:next}
})
const removeSection = (id,{secId}) => withSheet(id, async (db,sheet) => {
  if (!sheet.sections.some(s=>s.id===Number(secId))) throw new NotFoundError('Section not found')
  await db.evalSection.delete({where:{id:Number(secId)}})
  await normalize(db,sheet.sections.filter(s=>s.id!==Number(secId)))
  return {id:Number(secId),message:'Section deleted successfully'}
})
module.exports={orderBy,createSection,updateSection,removeSection}
