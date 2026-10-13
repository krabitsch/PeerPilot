// Small, dependency-free helpers for the teacher exports. Kept separate from the
// service so they can be unit-tested without a database or MinIO.

// Quote a field only when it contains a delimiter, quote or newline, doubling
// any inner quotes (RFC 4180).
const csvCell = (value) => {
    const s = value === null || value === undefined ? '' : String(value)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const csvRow = (cells) => cells.map(csvCell).join(',')

// Safe ZIP entry name / download filename component — strips path separators and
// anything exotic so an uploaded filename can't escape its folder (zip-slip).
const sanitize = (name) =>
    String(name ?? '').replace(/[\\/]/g, '_').replace(/[^\w.\- ]/g, '_').trim() || 'unnamed'

module.exports = { csvCell, csvRow, sanitize }
