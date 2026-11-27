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
// Trailing dots/spaces go too: Windows drops them on extract (and `..` would
// otherwise survive as a folder name).
const sanitize = (name) =>
    String(name ?? '').replace(/[\\/]/g, '_').replace(/[^\w.\- ]/g, '_').trim().replace(/[. ]+$/, '') || 'unnamed'

// Windows Explorer refuses to extract a path over 260 characters, counting the
// folder it extracts into (e.g. C:\Users\<name>\Downloads\<zip name>\). So the
// ZIP's names are capped: `shorten` cuts a component to `max` characters,
// keeping a short file extension, so an uploaded name like
// "Macro_Evaluation_09_11_26_Evaluator_..._Evaluee_....m4a" still opens.
const shorten = (name, max) => {
    const s = sanitize(name)
    if (s.length <= max) return s
    const dot = s.lastIndexOf('.')
    const ext = dot > 0 && s.length - dot <= 8 ? s.slice(dot) : ''
    return (s.slice(0, Math.max(1, max - ext.length)).replace(/[. ]+$/, '') || 'unnamed') + ext
}

// Budget for a typical ~40-char Downloads path: 40 + (44+1) zip folder +
// (44+1) root folder + 128 entry = 258 < 260.
const ARCHIVE_ROOT_MAX = 44
const ARCHIVE_ENTRY_MAX = 128
// Group names and usernames inside entry paths; the ids next to them keep
// entries unique, so the names only need to be recognisable.
const ARCHIVE_NAME_MAX = 20

// `dir` is already built from capped components; the file name absorbs the rest.
const fitEntry = (dir, leaf) => dir + shorten(leaf, Math.max(16, ARCHIVE_ENTRY_MAX - dir.length))

module.exports = { csvCell, csvRow, sanitize, shorten, fitEntry, ARCHIVE_ROOT_MAX, ARCHIVE_ENTRY_MAX, ARCHIVE_NAME_MAX }
