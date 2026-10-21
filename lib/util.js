'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function expandHome(p) {
  return typeof p === 'string' ? p.replace(/^~(?=$|[\\/])/, os.homedir()) : p
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** Claude Code's config dir: setting > CLAUDE_CONFIG_DIR > ~/.claude */
function claudeDir(setting) {
  return expandHome((setting && String(setting).trim()) || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'))
}

/** ISO string (any fractional digits) | epoch seconds | epoch millis -> millis, or null */
function parseTime(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? (v < 1e11 ? v * 1000 : v) : null
  if (typeof v !== 'string') return null
  if (/^\d+(\.\d+)?$/.test(v.trim())) return parseTime(Number(v))
  const t = Date.parse(v.replace(/(\.\d{3})\d+/, '$1'))
  return Number.isFinite(t) ? t : null
}

function readTail(file, bytes) {
  let fd = null
  try {
    const st = fs.statSync(file)
    fd = fs.openSync(file, 'r')
    const len = Math.min(bytes, st.size)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, st.size - len)
    return { text: buf.toString('utf8'), partialStart: st.size > len, size: st.size, mtimeMs: st.mtimeMs }
  } catch { return null } finally { if (fd != null) try { fs.closeSync(fd) } catch {} }
}

function readHead(file, bytes) {
  let fd = null
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(bytes)
    const n = fs.readSync(fd, buf, 0, bytes, 0)
    return buf.toString('utf8', 0, n)
  } catch { return null } finally { if (fd != null) try { fs.closeSync(fd) } catch {} }
}

const MIN = 60000
const HOUR = 3600000
const DAY = 86400000

module.exports = { expandHome, readJson, claudeDir, parseTime, readTail, readHead, MIN, HOUR, DAY }
