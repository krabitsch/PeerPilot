const {test}=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm'),fs=require('node:fs')
const errors=require('../../../../packages/errors')
const section=(id,marks=50)=>({id,evalSheetId:1,name:`Question ${id}`,description:'Description',marks,sectionType:'Slider',sortOrder:id-1,isBonus:false})
function harness(){
 const state={rows:[section(1),section(2)],next:3}
 const db={
  $queryRaw:async()=>[],
  evalSheet:{findUnique:async q=>{
    assert.deepEqual(JSON.parse(JSON.stringify(q.include.sections.orderBy)),[{sortOrder:'asc'},{id:'asc'}])
    return {id:1,assignment:{max_score:100},sections:[...state.rows].sort((a,b)=>a.sortOrder-b.sortOrder||a.id-b.id)}
  }},
  evalSection:{
   create:async({data})=>{const r={id:state.next++,...data};state.rows.push(r);return {...r}},
   update:async({where,data})=>{const r=state.rows.find(s=>s.id===where.id);Object.assign(r,data);return {...r}},
   delete:async({where})=>{state.rows=state.rows.filter(s=>s.id!==where.id)},
  },
 }
 db.$transaction=async fn=>{const saved=structuredClone(state);try{return await fn(db)}catch(e){Object.assign(state,saved);throw e}}
 const module={exports:{}}
 vm.runInNewContext(fs.readFileSync(__dirname+'/sheet-sections.js','utf8'),{module,require:name=>name==='@transcendence/database'?{prisma:db}:errors})
 return {state,api:module.exports}
}
test('moving Question 2 first persists normalized order, including after reload',async()=>{
 const {state,api}=harness()
 await api.updateSection(1,{secId:2,sortOrder:0})
 assert.deepEqual([...state.rows].sort((a,b)=>a.sortOrder-b.sortOrder).map(s=>s.id),[2,1])
 assert.deepEqual(state.rows.map(s=>s.sortOrder).sort(),[0,1])
 await api.removeSection(1,{secId:2})
 assert.equal(state.rows[0].sortOrder,0)
 await api.createSection(1,{name:'Third',description:'Description',marks:50,sectionType:'Toggle'})
 assert.deepEqual(state.rows.map(s=>s.sortOrder),[0,1])
})
test('atomic rubric save accepts 100 core plus 15 bonus, and rejects 90 core plus bonus',async()=>{
 const {state,api}=harness()
 const rows=[{...section(2),marks:30},{...section(1),marks:70},{...section(3),id:undefined,marks:15,isBonus:true}]
 const sheet=await api.updateSection(1,{sections:rows})
 assert.deepEqual(Array.from(sheet.sections,s=>s.name),['Question 2','Question 1','Question 3'])
 assert.equal(sheet.sections[2].isBonus,true)
 assert.deepEqual(state.rows.map(s=>s.sortOrder).sort(),[0,1,2])
 const before=JSON.stringify(state)
 rows[0].marks=20
 await assert.rejects(api.updateSection(1,{sections:rows}),/Core section marks must sum exactly/)
 assert.equal(JSON.stringify(state),before)
})
test('invalid, duplicate, or foreign IDs and out-of-range reorder positions fail without changes',async()=>{
 const {state,api}=harness(),before=JSON.stringify(state)
 for(const sortOrder of [-1,2,0.5,'0']) await assert.rejects(api.updateSection(1,{secId:2,sortOrder}),/Invalid section sort order/)
 for(const sections of [[section(1),section(1)],[section(99),section(1)]])
   await assert.rejects(api.updateSection(1,{sections}),/Invalid or duplicate/)
 assert.equal(JSON.stringify(state),before)
})
test('migration initializes oldest IDs first within each sheet and preserves existing core scores',()=>{
 const migration=fs.readFileSync(__dirname+'/../../../../packages/database/prisma/migrations/20261024090000_eval_section_order_bonus/migration.sql','utf8')
 assert.match(migration,/PARTITION BY "evalSheetId" ORDER BY id/)
 assert.match(migration,/"isBonus" BOOLEAN NOT NULL DEFAULT false/)
 assert.match(migration,/SET "coreScore" = "givenMarks"/)
})

test('zero-point core and bonus sections are valid; negative, fractional and over-100 marks are not',async()=>{
 const {state,api}=harness()
 const rows=[{...section(3),id:undefined,marks:0},section(1,20),section(2,30),{...section(4),id:undefined,marks:50},
  {...section(5),id:undefined,marks:0,isBonus:true}]
 const saved=await api.updateSection(1,{sections:rows})
 assert.equal(saved.sections.length,5)
 assert.equal(saved.sections.filter(s=>!s.isBonus).reduce((n,s)=>n+s.marks,0),100)
 for(const marks of [-1,101,0.5,null,'']) await assert.rejects(api.createSection(1,{...section(6),marks}),/Invalid evaluation section/)
 await api.createSection(1,{...section(6),marks:0})
 const zero=state.rows.at(-1)
 await api.updateSection(1,{secId:zero.id,marks:0})
 const before=JSON.stringify(state)
 await assert.rejects(api.updateSection(1,{sections:[{...section(1),marks:0},section(2,30)]}),/Core section marks must sum exactly/)
 assert.equal(JSON.stringify(state),before)
})
