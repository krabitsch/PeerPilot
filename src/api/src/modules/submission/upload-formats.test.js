const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm')
const formats=require('../../../../packages/fileManager/upload-formats')
const {fileAllowed,SUBMISSION_MAX_BYTES,AUDIO_MAX_BYTES}=formats
const documents=[['pdf','application/pdf'],['docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
 ['png','image/png'],['jpeg','image/jpeg'],['zip','application/zip'],['7z','application/x-7z-compressed'],
 ['rar','application/vnd.rar'],['tar','application/x-tar'],['tar.gz','application/gzip'],['tgz','application/x-gzip'],
 ['gz','application/gzip'],['tar.bz2','application/x-bzip2'],['tbz2','application/x-bzip2'],['bz2','application/x-bzip2'],
 ['tar.xz','application/x-xz'],['txz','application/x-xz'],['xz','application/x-xz'],['md','text/markdown'],
 ['rtf','application/rtf'],['odt','application/vnd.oasis.opendocument.text'],['tex','application/x-tex'],['csv','text/csv'],['pages','application/vnd.apple.pages']]
const audio=[['m4a','audio/mp4'],['mp3','audio/mpeg'],['wav','audio/vnd.wave'],['aac','audio/aac'],['webm','audio/webm'],
 ['ogg','audio/ogg'],['opus','audio/opus'],['flac','audio/flac'],['aif','audio/aiff'],['aiff','audio/x-aiff'],
 ['caf','audio/x-caf'],['3gp','audio/3gpp'],['amr','audio/amr']]
test('academic documents, images and archives accept recognized MIME and controlled generic/empty fallbacks',()=>{
 for(const [ext,mime] of documents) for(const type of [mime,'application/octet-stream',''])
  assert(fileAllowed(`PROJECT.${ext.toUpperCase()}`,type,false),`${ext}: ${type}`)
 for(const ext of formats.SUBMISSION_EXTENSIONS) assert(fileAllowed(`submission${ext}`,'',false))
})
test('common phone/tablet/desktop recordings accept audio MIME variants and extension fallbacks',()=>{
 for(const [ext,mime] of audio) for(const type of [mime,'application/octet-stream',''])
  assert(fileAllowed(`RECORDING.${ext.toUpperCase()}`,type,true),`${ext}: ${type}`)
 assert(fileAllowed('recording.webm','audio/webm; codecs=opus',true))
 assert(fileAllowed('recording.m4a','video/mp4',true))
 assert(!fileAllowed('movie.mp4','video/mp4',true))
 assert(!fileAllowed('movie.webm','video/webm',true))
})
test('unknown binaries, executables, misleading compound extensions and unrelated MIME are rejected',()=>{
 for(const audio of [false,true]) for(const name of ['program.exe','file.bin','file.tar.gz.exe','file.m4a.exe','script.js']) {
  assert(!fileAllowed(name,'application/octet-stream',audio));assert(!fileAllowed(name,'',audio))
 }
 assert(!fileAllowed('program.exe','application/pdf',false))
 assert(!fileAllowed('file.7z','application/x-msdownload',false))
 assert(!fileAllowed('file.m4a','application/x-msdownload',true))
 assert(!fileAllowed('file.zip','application/zip',true))
 assert(!fileAllowed('file.mp3','audio/mpeg',false))
})
test('submission/recording middleware uses friendly errors and retains independent limits without broadening shared uploads',()=>{
 const options=[]
 const multer=opts=>{options.push(opts);return {single:()=> (req,res,next)=>{
  if(req.tooLarge) return next(Object.assign(new Error('internal details'),{code:'LIMIT_FILE_SIZE'}))
  opts.fileFilter(req,req.file,next)
 }}}
 multer.memoryStorage=()=>({})
 const module={exports:{}}
 vm.runInNewContext(fs.readFileSync(__dirname+'/../../../../packages/fileManager/index.js','utf8'),{
  module,process:{env:{}},require:name=>name==='minio'?{Client:class{}}:name==='multer'?multer:formats,
 })
 const api=module.exports
 assert.equal(SUBMISSION_MAX_BYTES,50*1024*1024);assert.equal(AUDIO_MAX_BYTES,200*1024*1024)
 assert.equal(options[0].limits.fileSize,SUBMISSION_MAX_BYTES)
 options[0].fileFilter({}, {mimetype:'application/x-7z-compressed'},error=>assert(error))
 for(const [uploader,name,type,size] of [[api.submissionUploader,'project.7z','application/octet-stream',50],[api.recordingUploader,'voice.m4a','',200]]) {
  uploader.single('file')({file:{originalname:name,mimetype:type}},{},err=>assert.ifError(err))
  uploader.single('file')({file:{originalname:'program.exe',mimetype:'application/octet-stream'}},{},err=>{
   assert.equal(err.status,400);assert.match(err.message,/Unsupported/);assert(!err.message.includes('octet-stream'))
  })
  uploader.single('file')({tooLarge:true},{},err=>{assert.equal(err.status,400);assert(err.message.includes(`${size} MB`))})
 }
})
