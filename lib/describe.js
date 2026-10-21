'use strict'
/** describe.js — convierte una llamada a herramienta en una frase legible ("Leyendo src/app.ts"). */
const { t } = require('./i18n')
const AGENT_TOOLS = new Set(['Agent', 'Task'])

const short = (s, n = 90) => {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function rel(p, cwd) {
  if (!p) return ''
  p = String(p)
  if (cwd) {
    const c = String(cwd).replace(/[\\/]+$/, '')
    if (p.startsWith(c + '/') || p.startsWith(c + '\\')) p = p.slice(c.length + 1)
  }
  return short(p, 70)
}

function host(u) { try { return new URL(u).host } catch { return short(u, 50) } }

function describeTool(name, input, cwd) {
  const i = input && typeof input === 'object' ? input : {}
  switch (name) {
    case 'Read': return t('reading', rel(i.file_path || i.path, cwd))
    case 'Write': return t('writingFile', rel(i.file_path, cwd))
    case 'Edit': case 'MultiEdit': return t('editing', rel(i.file_path, cwd))
    case 'NotebookEdit': return t('editingNb', rel(i.notebook_path, cwd))
    case 'Bash': return t('running', short(i.description || i.command, 80))
    case 'BashOutput': return t('checkingOutput')
    case 'KillShell': case 'KillBash': return t('stopping')
    case 'Grep': return t('searching', short(i.pattern, 40), i.path ? rel(i.path, cwd) : '')
    case 'Glob': return t('findingFiles', short(i.pattern, 50))
    case 'LS': return t('listing', rel(i.path, cwd))
    case 'WebFetch': return t('opening', host(i.url))
    case 'WebSearch': return t('webSearch', short(i.query, 60))
    case 'Agent': case 'Task': return t('launched', short(i.description || i.subagent_type || t('agent'), 60))
    case 'TodoWrite': return t('todos')
    case 'Skill': return t('skill', short(i.skill || i.command || i.name, 40))
    case 'AskUserQuestion': return t('asking')
    case 'ExitPlanMode': return t('plan')
    case 'SlashCommand': return t('command', short(i.command, 40))
    case 'SubagentHandback': return t('handback')
  }
  if (/^mcp__/.test(name || '')) {
    const parts = name.split('__')
    return `MCP ${parts[1]} · ${parts.slice(2).join('__')}`
  }
  return String(name || t('tool'))
}

module.exports = { describeTool, short, rel, AGENT_TOOLS }
