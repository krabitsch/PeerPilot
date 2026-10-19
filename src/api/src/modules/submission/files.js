// Legacy fileId remains the original. Revised files are additive and ordered.
const fileVersionInclude = { include: { file: true }, orderBy: [{createdAt:'asc'}, {id:'asc'}] }
const submissionFiles = submission => [
  ...(submission.file ? [submission.file] : []),
  ...(submission.fileVersions ?? []).map(version => version.file),
]
module.exports = { fileVersionInclude, submissionFiles }
