// Keep browser and server upload policies aligned; both have format-compatibility tests.
export const SUBMISSION_EXTENSIONS = [".zip", ".7z", ".rar", ".tar", ".tar.gz", ".tgz", ".gz", ".tar.bz2", ".tbz2", ".bz2", ".tar.xz", ".txz", ".xz", ".pdf", ".txt", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".md", ".rtf", ".odt", ".tex", ".csv", ".pages"];
export const SUBMISSION_MIME_TYPES = ["application/zip", "application/x-zip-compressed", "application/x-7z-compressed", "application/vnd.rar", "application/x-rar-compressed", "application/x-rar", "application/x-tar", "application/x-gtar", "application/x-compressed-tar", "application/gzip", "application/x-gzip", "application/x-bzip", "application/x-bzip2", "application/x-bzip-compressed-tar", "application/x-xz", "application/x-xz-compressed-tar", "application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/markdown", "text/x-markdown", "application/rtf", "text/rtf", "application/vnd.oasis.opendocument.text", "application/x-tex", "text/x-tex", "text/csv", "application/csv", "application/vnd.apple.pages", "application/x-iwork-pages-sffpages"];
export const AUDIO_EXTENSIONS = [".m4a", ".mp3", ".wav", ".aac", ".webm", ".ogg", ".opus", ".flac", ".aif", ".aiff", ".caf", ".3gp", ".amr"];
export const AUDIO_MIME_TYPES = ["audio/mp4", "audio/x-m4a", "audio/mpeg", "audio/mp3", "audio/x-mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "audio/aac", "audio/x-aac", "audio/webm", "audio/ogg", "application/ogg", "audio/opus", "audio/flac", "audio/x-flac", "audio/aiff", "audio/x-aiff", "audio/x-caf", "audio/caf", "audio/3gpp", "audio/amr", "audio/amr-wb"];
export const EXECUTABLE_EXTENSIONS = [".exe", ".dll", ".com", ".bat", ".cmd", ".msi", ".ps1", ".sh", ".scr", ".app", ".jar", ".vbs", ".js", ".mjs", ".cjs"];
export const SUBMISSION_MAX_BYTES = 50 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 200 * 1024 * 1024;

export const fileAllowed = (name: string, mime: string, audio: boolean) => {
  const filename = name.toLowerCase();
  const type = mime.split(';')[0].trim().toLowerCase();
  if (EXECUTABLE_EXTENSIONS.some(ext => filename.endsWith(ext))) return false;
  // A phone may label an M4A audio recording as video/mp4. Restrict this
  // exception to M4A filenames; do not enable generic MP4 video uploads.
  if (audio && type === 'video/mp4') return filename.endsWith('.m4a');
  const extensions = audio ? AUDIO_EXTENSIONS : SUBMISSION_EXTENSIONS;
  if (!type || type === 'application/octet-stream') return extensions.some(ext => filename.endsWith(ext));
  return (audio ? AUDIO_MIME_TYPES : SUBMISSION_MIME_TYPES).includes(type);
};

export const SUBMISSION_ACCEPT = SUBMISSION_EXTENSIONS.join(',');
export const AUDIO_ACCEPT = ['audio/*', ...AUDIO_EXTENSIONS].join(',');
export const AUDIO_FORMAT_ERROR = 'Unsupported audio format. Please upload a common audio file such as M4A, MP3, WAV, AAC, or WebM.';
