import {fileAllowed,SUBMISSION_EXTENSIONS,AUDIO_EXTENSIONS,SUBMISSION_ACCEPT,AUDIO_ACCEPT,SUBMISSION_MAX_BYTES,AUDIO_MAX_BYTES} from './upload-formats';
describe('browser upload compatibility policy',()=>{
 it('preserves document/image support and adds all archive and academic formats with controlled fallbacks',()=>{
  for(const ext of SUBMISSION_EXTENSIONS) for(const mime of ['', 'application/octet-stream'])
   expect(fileAllowed(`Project${ext.toUpperCase()}`,mime,false)).toBe(true);
  for(const [ext,mime] of [['.pdf','application/pdf'],['.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['.png','image/png'],['.jpg','image/jpeg'],['.zip','application/zip'],['.7z','application/x-7z-compressed'],['.rar','application/vnd.rar'],['.tar','application/x-tar'],['.tar.gz','application/gzip'],['.tgz','application/x-gzip'],['.bz2','application/x-bzip2'],['.xz','application/x-xz']])
   expect(fileAllowed(`Project${ext}`,mime,false)).toBe(true);
  expect(SUBMISSION_ACCEPT.split(',')).toEqual(SUBMISSION_EXTENSIONS);
 });
 it('accepts common audio MIME variants, parameterized MIME and mobile generic types',()=>{
  for(const ext of AUDIO_EXTENSIONS) for(const mime of ['', 'application/octet-stream'])
   expect(fileAllowed(`Voice${ext.toUpperCase()}`,mime,true)).toBe(true);
  for(const [ext,mime] of [['.m4a','audio/x-m4a'],['.mp3','audio/mp3'],['.wav','audio/x-wav'],['.aac','audio/aac'],['.webm','audio/webm;codecs=opus'],['.ogg','audio/ogg'],['.flac','audio/flac'],['.aiff','audio/aiff'],['.caf','audio/x-caf'],['.3gp','audio/3gpp'],['.amr','audio/amr']])
   expect(fileAllowed(`Voice${ext}`,mime,true)).toBe(true);
  expect(fileAllowed('Voice.m4a','video/mp4',true)).toBe(true);
  expect(fileAllowed('Video.mp4','video/mp4',true)).toBe(false);
  expect(AUDIO_ACCEPT).toContain('audio/*');expect(AUDIO_ACCEPT).toContain('.m4a');
 });
 it('rejects executables, unknown binaries and non-generic mismatched MIME while retaining size limits',()=>{
  for(const audio of [false,true]) for(const type of ['', 'application/octet-stream'])
   expect(fileAllowed('program.exe',type,audio)).toBe(false);
  expect(fileAllowed('program.exe','application/pdf',false)).toBe(false);
  expect(fileAllowed('unknown.bin','application/octet-stream',false)).toBe(false);
  expect(fileAllowed('archive.7z','application/x-msdownload',false)).toBe(false);
  expect(SUBMISSION_MAX_BYTES).toBe(50*1024*1024);expect(AUDIO_MAX_BYTES).toBe(200*1024*1024);
 });
});
