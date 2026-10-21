'use strict'
/**
 * reader.js — lector incremental de un transcript JSONL de Claude Code (chat principal o subagente).
 * Solo procesa los bytes nuevos en cada pasada (streaming), así que seguir un archivo grande es barato.
 *
 * Por cada archivo mantiene:
 *  - actividad reciente (herramientas con su estado, textos del modelo, prompts) en un buffer circular
 *  - tokens: contexto actual (input + caché del último mensaje) y salida acumulada (deduplicada por message.id)
 *  - llamadas a Agent/Task del archivo y su resultado (agentId, estado, totales) para enlazarlas con los subagentes
 *  - la lista TodoWrite más reciente y totales por día (para el resumen "Hoy")
 */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const { describeTool, short, AGENT_TOOLS } = require('./describe')
const { t: tr } = require('./i18n')

const MAX_ACTIVITY = 120

function dayKey(t) {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fresh() {
  return {
    title: null, lastPrompt: null, firstPrompt: null, model: null, version: null, cwd: null, gitBranch: null, entrypoint: null,
    context: 0, output: 0, messages: 0, tools: 0, toolsByName: {},
    firstAt: null, lastAt: null, prompts: 0,
    activity: [], pending: {},
    agentCalls: {}, agentById: {},
    todos: null, last: null, byDay: {}, models: {}
  }
}

const ts = o => { const t = o && o.timestamp ? Date.parse(o.timestamp) : NaN; return Number.isFinite(t) ? t : null }

function userText(o) {
  const c = o && o.message && o.message.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.filter(b => b && b.type === 'text').map(b => b.text || '').join(' ')
  return ''
}

function push(s, ev) {
  s.activity.push(ev)
  if (s.activity.length > MAX_ACTIVITY) s.activity.splice(0, s.activity.length - MAX_ACTIVITY)
}

function day(s, t) {
  const k = dayKey(t || Date.now())
  return s.byDay[k] || (s.byDay[k] = { output: 0, input: 0, messages: 0, tools: 0 })
}

/** Marca como terminada la llamada Agent que lanzó al agente agentId (aviso de fin o entrega de informe). */
function finishAgent(s, agentId, status, t) {
  const call = agentId && s.agentCalls[s.agentById[agentId]]
  if (!call) return null
  if (call.status !== 'error') call.status = status
  if (!call.endAt) call.endAt = t
  if (status === 'completed') call.notified = true
  return call
}

/** Función pura: incorpora una línea ya parseada. opts.sidechain = true para archivos de subagente. */
function applyLine(s, o, ctx, opts = {}) {
  if (!o || typeof o !== 'object') return
  if (o.isSidechain && !opts.sidechain) return
  const t = ts(o)
  if (t) { if (!s.firstAt) s.firstAt = t; s.lastAt = t }
  if (o.cwd && !s.cwd) s.cwd = o.cwd
  if (o.version) s.version = o.version
  if (o.gitBranch) s.gitBranch = o.gitBranch
  if (o.entrypoint && !s.entrypoint) s.entrypoint = o.entrypoint

  switch (o.type) {
    case 'ai-title': if (o.aiTitle) s.title = String(o.aiTitle); return
    case 'summary': if (o.summary && !s.title) s.title = String(o.summary); return
    case 'last-prompt': if (o.lastPrompt) s.lastPrompt = String(o.lastPrompt); return
    case 'system':
      if (o.subtype === 'stop_hook_summary' || o.subtype === 'turn_duration') s.last = { kind: 'end', at: t }
      return
    case 'user': {
      const c = o.message && o.message.content
      if (Array.isArray(c) && c.some(b => b && b.type === 'tool_result')) {
        let handedBack = false
        for (const b of c) {
          if (!b || b.type !== 'tool_result') continue
          const item = s.pending[b.tool_use_id]
          if (item) { item.done = true; item.endAt = t; item.error = !!b.is_error; delete s.pending[b.tool_use_id] }
          // El subagente entrega su informe final con esta herramienta: después de su resultado ya terminó
          if (item && item.name === 'SubagentHandback') handedBack = true
          const call = s.agentCalls[b.tool_use_id]
          const r = o.toolUseResult
          if (call) {
            if (r && typeof r === 'object') {
              if (r.agentId) { call.agentId = String(r.agentId); s.agentById[call.agentId] = call.toolUseId }
              if (r.status) call.status = String(r.status)
              if (r.totalTokens != null) call.totalTokens = Number(r.totalTokens) || 0
              if (r.totalToolUseCount != null) call.totalTools = Number(r.totalToolUseCount) || 0
              if (r.totalDurationMs != null) call.durationMs = Number(r.totalDurationMs) || 0
            }
            if (b.is_error) call.status = 'error'
            // Un agente en segundo plano devuelve un resultado inmediato ("lanzado"): no está terminado todavía
            const asyncLaunch = call.status && /async|launch|background|running/i.test(call.status)
            if (!asyncLaunch) call.endAt = t
          }
        }
        s.last = { kind: handedBack ? 'end' : 'result', at: t }
        return
      }
      // Avisos del propio Claude Code sobre agentes en segundo plano: no son mensajes del usuario
      const origin = o.origin && typeof o.origin === 'object' ? o.origin : null
      if (origin && origin.kind === 'peer' && origin.handback && origin.from) {
        const call = finishAgent(s, String(origin.from), 'completed', t)
        push(s, { kind: 'notify', text: tr('reportFrom', (call && call.description) || origin.name || tr('anAgent')), at: t })
        return
      }
      const raw = userText(o).trim()
      if ((origin && origin.kind === 'task-notification') || /^<task-notification>/.test(raw)) {
        const tag = k => { const m = raw.match(new RegExp(`<${k}>([\\s\\S]*?)</${k}>`)); return m ? m[1].trim() : '' }
        const status = tag('status')
        const call = finishAgent(s, tag('task-id'), /fail|error/i.test(status) ? 'error' : 'completed', t)
        if (!call || !call.notified) push(s, { kind: 'notify', text: tag('summary') || tr('bgTaskDone'), at: t })
        if (call) call.notified = true
        s.last = { kind: 'prompt', at: t } // el chat principal retoma el trabajo al recibir el aviso
        return
      }
      if (o.toolUseResult || o.isMeta) return
      const text = userText(o).trim()
      if (!text) return
      if (/^\[Request interrupted/.test(text)) {
        push(s, { kind: 'interrupt', text: tr('interrupted'), at: t })
        s.last = { kind: 'end', at: t }
        return
      }
      if (/^<(command-|local-command|system-reminder|bash-)/.test(text)) return
      s.prompts += 1
      if (!s.firstPrompt) s.firstPrompt = text
      push(s, { kind: 'prompt', text: short(text, 400), at: t })
      s.last = { kind: 'prompt', at: t }
      return
    }
    case 'assistant': {
      const m = o.message
      if (!m || typeof m !== 'object') return
      if (m.model && m.model !== '<synthetic>') s.model = m.model
      const u = m.usage
      if (u && typeof u === 'object') {
        const input = (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0)
        s.context = input
        const id = m.id || o.requestId || null
        if (!id || id !== ctx.lastMsgId) {
          ctx.lastMsgId = id
          const out = Number(u.output_tokens) || 0
          s.output += out
          s.messages += 1
          const d = day(s, t)
          d.output += out; d.input += input; d.messages += 1
          if (m.model && m.model !== '<synthetic>') s.models[m.model] = (s.models[m.model] || 0) + 1
        }
      }
      const c = m.content
      if (!Array.isArray(c)) return
      for (const b of c) {
        if (!b) continue
        if (b.type === 'text' && b.text && b.text.trim()) {
          push(s, { kind: 'text', text: short(b.text, 320), at: t })
          s.last = { kind: 'text', at: t }
        } else if (b.type === 'tool_use') {
          const key = b.id || `${b.name}@${t}`
          if (ctx.seen.has(key)) continue
          ctx.seen.add(key)
          const name = b.name || '?'
          s.tools += 1
          s.toolsByName[name] = (s.toolsByName[name] || 0) + 1
          day(s, t).tools += 1
          const item = { kind: 'tool', id: key, name, text: describeTool(name, b.input, s.cwd), at: t, done: false }
          push(s, item)
          s.pending[key] = item
          s.last = { kind: 'tool', at: t, name, id: key }
          const inp = b.input && typeof b.input === 'object' ? b.input : {}
          if (AGENT_TOOLS.has(name)) {
            s.agentCalls[key] = {
              toolUseId: key, description: String(inp.description || ''), agentType: String(inp.subagent_type || 'general-purpose'),
              background: !!inp.run_in_background, prompt: short(inp.prompt || '', 600), at: t, agentId: null, status: null, endAt: null
            }
          }
          if (name === 'TodoWrite' && Array.isArray(inp.todos)) {
            s.todos = { at: t, items: inp.todos.map(x => ({ name: String((x && (x.content || x.subject)) || ''), state: String((x && x.status) || 'pending'), note: String((x && x.activeForm) || '') })).filter(x => x.name) }
          }
        }
      }
      return
    }
    default:
  }
}

/**
 * Estado derivado de la última entrada significativa.
 * status: running | waiting | done | idle | stale | starting ; action: frase de qué está haciendo ahora
 */
function deriveStatus(s, mtimeMs, nowMs, { isAgent = false } = {}) {
  const last = s.last
  if (!last) return { status: 'starting', action: isAgent ? tr('starting') : '' }
  const at = last.at || mtimeMs || nowMs
  const age = nowMs - at
  const fileAge = mtimeMs ? nowMs - mtimeMs : age
  const finished = isAgent ? 'done' : 'idle'
  if (last.kind === 'end') return { status: finished, action: '' }
  if (last.kind === 'tool') {
    const item = s.pending[last.id]
    if (!item) return { status: 'running', action: tr('thinking') }
    if (age > 30 * 60000 && fileAge > 30 * 60000) return { status: 'stale', action: item.text }
    const longTool = AGENT_TOOLS.has(last.name) || ['Bash', 'BashOutput', 'WebFetch', 'WebSearch'].includes(last.name)
    if (!longTool && age > 30000 && fileAge > 30000) return { status: 'waiting', action: item.text }
    if (AGENT_TOOLS.has(last.name)) return { status: 'running', action: tr('waitingAgents') }
    return { status: 'running', action: item.text }
  }
  if (last.kind === 'result' || last.kind === 'prompt') {
    if (age < 10 * 60000) return { status: 'running', action: tr('thinking') }
    return { status: 'stale', action: '' }
  }
  if (last.kind === 'text') {
    if (Math.min(age, fileAge) < 5000) return { status: 'running', action: tr('writing') }
    return { status: finished, action: '' }
  }
  return { status: finished, action: '' }
}

class Reader {
  constructor(file, opts = {}) {
    this.file = file
    this.opts = opts
    this.loading = null
    this.mtime = null
    this.size = 0
    this.reset()
  }

  reset() {
    this.offset = 0
    this.rest = Buffer.alloc(0)
    this.s = fresh()
    this.ctx = { seen: new Set(), lastMsgId: null }
  }

  async update() {
    let st
    try { st = await fsp.stat(this.file) } catch { this.missing = true; return this.s }
    this.missing = false
    this.mtime = st.mtimeMs
    this.size = st.size
    if (st.size < this.offset) this.reset()
    if (st.size === this.offset) return this.s
    if (!this.loading) this.loading = this._read(st.size).finally(() => { this.loading = null })
    await this.loading
    return this.s
  }

  _read(toSize) {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(this.file, { start: this.offset, end: toSize - 1, highWaterMark: 256 * 1024 })
      stream.on('data', chunk => {
        const buf = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk
        let from = 0
        for (;;) {
          const nl = buf.indexOf(0x0a, from)
          if (nl < 0) break
          if (nl > from) {
            let o = null
            try { o = JSON.parse(buf.toString('utf8', from, nl)) } catch {}
            if (o) applyLine(this.s, o, this.ctx, this.opts)
          }
          from = nl + 1
        }
        this.rest = from < buf.length ? Buffer.from(buf.subarray(from)) : Buffer.alloc(0)
      })
      stream.on('end', () => { this.offset = toSize; resolve() })
      stream.on('error', reject)
    })
  }
}

module.exports = { Reader, applyLine, deriveStatus, fresh, dayKey, userText }
