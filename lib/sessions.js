'use strict'
/**
 * sessions.js — descubre los chats sin hooks: recorre <claudeDir>/projects/<proyecto>/<sesión>.jsonl.
 * Para la lista solo lee el inicio (carpeta, origen) y el final (título, estado) de cada archivo, con caché por tamaño.
 * Los subagentes viven en <proyecto>/<sesión>/subagents/agent-<id>.jsonl (+ .meta.json).
 * Basado en la idea de karin-lin/claude-code-panel (MIT).
 */
const fs = require('node:fs')
const path = require('node:path')
const { readHead, readTail, readJson, DAY } = require('./util')
const { t: tr, getLang } = require('./i18n')
const { fresh, applyLine, deriveStatus } = require('./reader')

const TAIL_BYTES = 160 * 1024
const HEAD_BYTES = 64 * 1024
const AGENT_ACTIVE_MS = 120000

function sourceKind(entrypoint) {
  if (!entrypoint) return tr('unknown')
  if (/vscode|jetbrains|ide|cursor/.test(entrypoint)) return 'IDE'
  if (entrypoint === 'cli') return 'Terminal'
  if (entrypoint.startsWith('sdk')) return 'SDK'
  return entrypoint
}

const headCache = new Map()
function headInfo(file) {
  const hit = headCache.get(file)
  if (hit) return hit
  const text = readHead(file, HEAD_BYTES) || ''
  const info = { cwd: null, entrypoint: null, version: null, gitBranch: null, firstPrompt: null }
  for (const line of text.split('\n')) {
    let o; try { o = JSON.parse(line) } catch { continue }
    if (!info.cwd && o.cwd) info.cwd = o.cwd
    if (!info.entrypoint && o.entrypoint) info.entrypoint = o.entrypoint
    if (!info.version && o.version) info.version = o.version
    if (!info.gitBranch && o.gitBranch) info.gitBranch = o.gitBranch
    if (!info.firstPrompt && o.type === 'user' && !o.isMeta && !o.toolUseResult && o.message) {
      const c = o.message.content
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join(' ') : ''
      if (t && !/^</.test(t.trim())) info.firstPrompt = t.trim().slice(0, 80)
    }
    if (info.cwd && info.entrypoint && info.firstPrompt) break
  }
  if (info.cwd || info.entrypoint) headCache.set(file, info)
  if (headCache.size > 400) headCache.delete(headCache.keys().next().value)
  return info
}

const tailCache = new Map()
function tailStats(file, size, mtimeMs) {
  const key = `${size}:${mtimeMs}:${getLang()}` // las frases dependen del idioma
  const hit = tailCache.get(file)
  if (hit && hit.key === key) return hit.s
  const s = fresh()
  const ctx = { seen: new Set(), lastMsgId: null }
  const tail = readTail(file, TAIL_BYTES)
  if (tail) {
    const lines = tail.text.split('\n')
    if (tail.partialStart) lines.shift()
    for (const l of lines) {
      if (!l) continue
      let o; try { o = JSON.parse(l) } catch { continue }
      applyLine(s, o, ctx)
    }
  }
  tailCache.set(file, { key, s })
  if (tailCache.size > 200) tailCache.delete(tailCache.keys().next().value)
  return s
}

/** Archivos de subagente de una sesión: [{ fileId, agentId, file, metaFile, meta, mtimeMs, size, startedAt }] */
function listAgentFiles(sessionFile) {
  const dir = path.join(sessionFile.replace(/\.jsonl$/, ''), 'subagents')
  let names
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out = []
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue
    const fileId = n.slice(0, -6)
    const file = path.join(dir, n)
    let st; try { st = fs.statSync(file) } catch { continue }
    const metaFile = path.join(dir, fileId + '.meta.json')
    let birth = null
    try { const ms = fs.statSync(metaFile); birth = ms.birthtimeMs || ms.mtimeMs } catch {}
    out.push({ fileId, agentId: fileId.replace(/^agent-/, ''), file, metaFile, mtimeMs: st.mtimeMs, size: st.size, startedAt: birth || st.birthtimeMs || null })
  }
  return out
}

const metaCache = new Map()
function agentMeta(a) {
  const hit = metaCache.get(a.metaFile)
  if (hit) return hit
  const m = readJson(a.metaFile) || {}
  const meta = { agentType: m.agentType || m.subagent_type || null, description: m.description || null, shape: m.requestShape || null }
  metaCache.set(a.metaFile, meta)
  if (metaCache.size > 1000) metaCache.delete(metaCache.keys().next().value)
  return meta
}

/** Escanea los chats modificados en las últimas windowMs (solo stat, el contenido se relee si cambió). */
function scanSessions({ claudeDir, windowMs = DAY, max = 40 } = {}, nowMs = Date.now()) {
  const root = path.join(claudeDir, 'projects')
  let projects = []
  try { projects = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()) } catch { return [] }
  const found = []
  let scanned = 0
  for (const d of projects) {
    let names = []
    try { names = fs.readdirSync(path.join(root, d.name)) } catch { continue }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue
      if (++scanned > 8000) break
      const file = path.join(root, d.name, n)
      let st; try { st = fs.statSync(file) } catch { continue }
      // Un chat puede estar quieto mientras sus agentes trabajan: también cuenta la actividad de la carpeta subagents
      let sub = null
      try { sub = fs.statSync(path.join(root, d.name, n.slice(0, -6), 'subagents')).mtimeMs } catch {}
      const touched = Math.max(st.mtimeMs, sub || 0)
      if (nowMs - touched > windowMs) continue
      found.push({ file, id: n.slice(0, -6), mtimeMs: st.mtimeMs, touched, size: st.size, projectDir: d.name })
    }
  }
  found.sort((a, b) => b.touched - a.touched)
  return found.slice(0, max).map(f => {
    const h = headInfo(f.file)
    const s = tailStats(f.file, f.size, f.mtimeMs)
    const st = deriveStatus(s, f.mtimeMs, nowMs)
    const agents = listAgentFiles(f.file)
    const agentsActive = agents.filter(a => nowMs - a.mtimeMs < AGENT_ACTIVE_MS).length
    const name = h.cwd ? (path.basename(h.cwd.replace(/[\\/]+$/, '')) || h.cwd) : f.projectDir
    const running = st.status === 'running' || st.status === 'waiting' || agentsActive > 0
    return {
      id: f.id, file: f.file, projectDir: f.projectDir, mtimeMs: f.mtimeMs,
      cwd: h.cwd, project: name, source: sourceKind(h.entrypoint), version: s.version || h.version, gitBranch: s.gitBranch || h.gitBranch,
      title: s.title || (s.lastPrompt ? s.lastPrompt.slice(0, 80) : null) || h.firstPrompt || tr('untitled'),
      model: s.model, status: st.status, action: st.action, running,
      agentsTotal: agents.length, agentsActive,
      updatedAt: Math.max(f.touched, s.lastAt || 0)
    }
  })
}

/** Busca el archivo de una sesión por id aunque no esté en la ventana de 24 h. */
function findSession(claudeDir, id) {
  const root = path.join(claudeDir, 'projects')
  let projects = []
  try { projects = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()) } catch { return null }
  for (const d of projects) {
    const file = path.join(root, d.name, id + '.jsonl')
    if (fs.existsSync(file)) return file
  }
  return null
}

const norm = p => (p || '').replace(/[\\/]+$/, '')
function inWorkspace(s, dirs) {
  const c = norm(s.cwd)
  return !!c && (dirs || []).some(d => { const w = norm(d); return c === w || c.startsWith(w + '/') || c.startsWith(w + '\\') })
}

module.exports = { scanSessions, listAgentFiles, agentMeta, findSession, sourceKind, inWorkspace, headInfo, AGENT_ACTIVE_MS }
