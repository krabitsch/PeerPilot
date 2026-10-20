// Legacy fileId remains the original. Revised files are additive and ordered.
const fileVersionInclude = { include: { file: true }, orderBy: [{createdAt:'asc'}, {id:'asc'}] }
const submissionFiles = submission => [
  ...(submission.file ? [submission.file] : []),
  ...[...(submission.fileVersions ?? [])].sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id-b.id).map(version => version.file),
]
module.exports = { fileVersionInclude, submissionFiles }

// Individual downloads deliberately select only the latest chronological version.
const latestSubmissionFile = submission => submissionFiles(submission).at(-1)
module.exports.latestSubmissionFile = latestSubmissionFile
