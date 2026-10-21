'use strict'
/** snapshot.js — junta todo en un único objeto para la vista. No depende de vscode (se puede probar con node). */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { claudeDir, readJson } = require('./util')
const { Reader, deriveStatus, dayKey } = require('./reader')
const { scanSessions, listAgentFiles, agentMeta, findSession, headInfo, sourceKind, inWorkspace, AGENT_ACTIVE_MS } = require('./sessions')
const { short } = require('./describe')
const { t: tr, getLang } = require('./i18n')

const MAX_READERS = 200
const FEED_FULL = 80
const FEED_PEEK = 3

// ── Cuenta: solo datos de perfil de ~/.claude.json (nunca tokens ni credenciales) ──
let accountCache = { file: null, mtime: null, value: null }
function readAccount(dir) {
  const candidates = [path.join(dir, '.claude.json'), path.join(path.dirname(dir), '.claude.json'), path.join(os.homedir(), '.claude.json')]
  for (const file of candidates) {
    let st; try { st = fs.statSync(file) } catch { continue }
    if (accountCache.file === file && accountCache.mtime === st.mtimeMs) return accountCache.value
    const j = readJson(file) || {}
    const a = j.oauthAccount || {}
    const value = {
      email: a.emailAddress || null, name: a.displayName || null, org: a.organizationName || null,
      role: a.organizationRole || a.workspaceRole || null, billing: a.billingType || null
    }
    accountCache = { file, mtime: st.mtimeMs, value }
    return value
  }
  return { email: null, name: null, org: null, role: null, billing: null }
}

function createCollector() {
  const readers = new Map()
  let today = null
  let chain = Promise.resolve()

  function reader(file, opts) {
    let r = readers.get(file)
    if (r) { readers.delete(file); readers.set(file, r); return r }
    r = new Reader(file, opts)
    readers.set(file, r)
    while (readers.size > MAX_READERS) readers.delete(readers.keys().next().value)
    return r
  }

  const slimFeed = (list, full) => {
    const src = full ? list.slice(-FEED_FULL) : list.filter(e => e.kind === 'tool' || e.kind === 'text').slice(-FEED_PEEK)
    return src.map(e => ({ kind: e.kind, name: e.name || null, text: e.text, at: e.at, endAt: e.endAt || null, done: e.kind === 'tool' ? !!e.done : true, error: !!e.error }))
  }

  /** Detalle de un chat: nodo principal + un nodo por subagente, con lo que hace cada uno ahora mismo. */
  async function buildDetail(file, chatId, wantedNodes, nowMs) {
    const main = reader(file, { sidechain: false })
    const ms = await main.update()
    const h = headInfo(file)
    const mainSt = deriveStatus(ms, main.mtime, nowMs)
    const files = listAgentFiles(file)
    const byAgentId = new Map(files.map(f => [f.agentId, f]))
    const usedCalls = new Set()
    const nodes = []

    for (const f of files) {
      const r = reader(f.file, { sidechain: true })
      const s = await r.update()
      const meta = agentMeta(f)
      let callId = ms.agentById[f.agentId] || ms.agentById[f.fileId] || null
      if (!callId) {
        // Sin agentId en el resultado (aún corriendo): emparejar por descripción con una llamada sin asignar
        const cand = Object.values(ms.agentCalls).find(c => !usedCalls.has(c.toolUseId) && !c.agentId && meta.description && c.description === meta.description)
        if (cand) callId = cand.toolUseId
      }
      const call = callId ? ms.agentCalls[callId] : null
      if (call) usedCalls.add(call.toolUseId)
      let st = deriveStatus(s, r.mtime, nowMs, { isAgent: true })
      if (call && call.status === 'completed') st = { status: 'done', action: '' }
      else if (call && (call.status === 'error' || call.status === 'failed')) st = { status: 'error', action: tr('endedError') }
      else if (call && call.endAt && st.status !== 'running') st = { status: 'done', action: '' }
      else if (st.status === 'running' && nowMs - r.mtime > 10 * 60000) st = { status: 'stale', action: st.action }
      const id = 'a:' + f.agentId
      nodes.push({
        id, kind: 'agent', file: f.file,
        title: short((call && call.description) || meta.description || s.firstPrompt || meta.agentType || tr('subagent'), 90),
        agentType: (call && call.agentType) || meta.agentType || 'general-purpose',
        background: !!((call && call.background) || meta.shape === 'background'),
        prompt: (call && call.prompt) || short(s.firstPrompt || '', 600),
        status: st.status, action: st.action,
        startedAt: (call && call.at) || s.firstAt || f.startedAt, updatedAt: Math.max(r.mtime || 0, s.lastAt || 0),
        endedAt: st.status === 'done' || st.status === 'error' ? ((call && call.endAt) || s.lastAt) : null,
        tokens: s.context || (call && call.totalTokens) || 0, output: s.output, tools: s.tools || (call && call.totalTools) || 0,
        model: s.model, children: Object.keys(s.agentCalls).length,
        feed: slimFeed(s.activity, wantedNodes.has(id))
      })
    }
    // Agentes recién lanzados que todavía no escribieron su archivo
    for (const c of Object.values(ms.agentCalls)) {
      if (usedCalls.has(c.toolUseId) || (c.agentId && byAgentId.has(c.agentId))) continue
      if (c.endAt && nowMs - c.endAt > 30 * 60000) continue
      if (!c.endAt && nowMs - c.at > 30 * 60000) continue
      const done = c.status === 'completed' || (!!c.endAt && !c.background)
      nodes.push({
        id: 'c:' + c.toolUseId, kind: 'agent', file: null, title: short(c.description || c.agentType, 90), agentType: c.agentType, background: c.background,
        prompt: c.prompt, status: c.status === 'error' ? 'error' : done ? 'done' : 'starting', action: done ? '' : tr('starting'),
        startedAt: c.at, updatedAt: c.endAt || c.at, endedAt: c.endAt, tokens: c.totalTokens || 0, output: 0, tools: c.totalTools || 0,
        model: null, children: 0, feed: []
      })
    }
    nodes.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    const shownNodes = nodes.slice(0, 60)
    const working = nodes.filter(n => n.status === 'running' || n.status === 'waiting' || n.status === 'starting').length
    let mainStatus = mainSt
    if (mainStatus.status !== 'running' && mainStatus.status !== 'waiting' && working) mainStatus = { status: 'running', action: tr('agentsBackground', working) }
    const mainNode = {
      id: 'main', kind: 'main', file,
      title: short(ms.title || (ms.lastPrompt ? ms.lastPrompt : '') || h.firstPrompt || tr('chat'), 90),
      agentType: 'principal', status: mainStatus.status, action: mainStatus.action,
      startedAt: ms.firstAt, updatedAt: Math.max(main.mtime || 0, ms.lastAt || 0), endedAt: null,
      tokens: ms.context, output: ms.output, tools: ms.tools, model: ms.model, children: nodes.length,
      feed: slimFeed(ms.activity, wantedNodes.has('main') || wantedNodes.size === 0)
    }
    return {
      id: chatId, file, cwd: ms.cwd || h.cwd, project: (ms.cwd || h.cwd) ? path.basename(String(ms.cwd || h.cwd).replace(/[\\/]+$/, '')) : '',
      source: sourceKind(ms.entrypoint || h.entrypoint), gitBranch: ms.gitBranch || h.gitBranch, version: ms.version || h.version,
      main: mainNode, agents: shownNodes, hiddenAgents: nodes.length - shownNodes.length, working,
      todos: ms.todos, prompts: ms.prompts, toolsByName: ms.toolsByName
    }
  }

  /** Totales de hoy (chats + subagentes modificados hoy). Lectura incremental: la primera vez es la más cara. */
  async function buildToday(sessions, nowMs) {
    const key = dayKey(nowMs)
    const start = new Date(nowMs); start.setHours(0, 0, 0, 0)
    const t0 = start.getTime()
    const acc = { output: 0, input: 0, messages: 0, tools: 0, chats: 0, agents: 0, models: {}, computedAt: nowMs }
    const todays = sessions.filter(s => s.updatedAt >= t0).slice(0, 25)
    for (const s of todays) {
      acc.chats += 1
      const files = [{ file: s.file, opts: { sidechain: false } }]
      for (const a of listAgentFiles(s.file)) if (a.mtimeMs >= t0) { files.push({ file: a.file, opts: { sidechain: true } }); acc.agents += 1 }
      for (const f of files.slice(0, 40)) {
        let st
        try { st = await reader(f.file, f.opts).update() } catch { continue }
        const d = st.byDay[key]
        if (d) { acc.output += d.output; acc.input += d.input; acc.messages += d.messages; acc.tools += d.tools }
        for (const [m, n] of Object.entries(st.models)) acc.models[m] = (acc.models[m] || 0) + n
      }
    }
    return acc
  }

  async function collect(cfg = {}, nowMs = Date.now()) {
    const dir = claudeDir(cfg.claudeDir)
    const sessions = scanSessions({ claudeDir: dir }, nowMs)
    const wanted = new Map()
    for (const sel of cfg.selections || []) {
      if (!sel || !sel.chatId) continue
      if (!wanted.has(sel.chatId)) wanted.set(sel.chatId, new Set())
      if (sel.nodeId) wanted.get(sel.chatId).add(sel.nodeId)
    }
    const details = {}
    for (const [id, nodeIds] of wanted) {
      const s = sessions.find(x => x.id === id)
      const file = s ? s.file : findSession(dir, id)
      if (!file) continue
      try { details[id] = await buildDetail(file, id, nodeIds, nowMs) } catch (e) { details[id] = { id, error: String(e && e.message || e) } }
    }
    if (cfg.withStats || !today || dayKey(today.computedAt) !== dayKey(nowMs)) {
      try { today = await buildToday(sessions, nowMs) } catch { today = today || null }
    }
    const ws = cfg.workspaceDirs || []
    const chats = sessions.map(s => {
      const d = details[s.id]
      const c = { ...s, inWorkspace: inWorkspace(s, ws) }
      if (d && d.main) { // el detalle es más preciso que la lectura de la cola del archivo
        c.status = d.main.status; c.action = d.main.action; c.agentsActive = d.working; c.agentsTotal = d.agents.length + d.hiddenAgents
        c.running = d.main.status === 'running' || d.main.status === 'waiting'
      }
      return c
    })
    const versions = chats.map(c => c.version).filter(Boolean)
    return {
      now: nowMs, claudeDir: dir, lang: getLang(),
      account: { ...readAccount(dir), version: versions[0] || null },
      today, chats, details,
      totals: {
        running: chats.filter(c => c.running).length,
        agentsActive: chats.reduce((n, c) => n + (c.agentsActive || 0), 0),
        waiting: chats.filter(c => c.status === 'waiting').length
      }
    }
  }

  // Las pasadas se encadenan: nunca hay dos leyendo los mismos archivos a la vez
  return {
    collect(cfg, nowMs) {
      const p = chain.then(() => collect(cfg, nowMs))
      chain = p.catch(() => {})
      return p
    }
  }
}

module.exports = { createCollector, readAccount, AGENT_ACTIVE_MS }
