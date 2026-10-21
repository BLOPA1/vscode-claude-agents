'use strict'
/**
 * i18n.js — textos del lado del host (estados, frases de herramientas, barra de estado) en inglés y español.
 * Los textos de la vista están en webview/panel.js; los del manifiesto en package.nls*.json.
 */
const STRINGS = {
  en: {
    unknown: 'unknown', untitled: 'Untitled chat', chat: 'Chat', subagent: 'Subagent',
    starting: 'Starting…', thinking: 'Thinking…', writing: 'Writing…', waitingAgents: 'Waiting for its agents',
    endedError: 'Finished with an error', agentsBackground: n => `${n} agent${n === 1 ? '' : 's'} working in the background`,
    interrupted: 'Interrupted by the user', reportFrom: x => `Report from ${x}`, anAgent: 'an agent', bgTaskDone: 'A background task finished',
    reading: x => `Reading ${x}`, writingFile: x => `Writing ${x}`, editing: x => `Editing ${x}`, editingNb: x => `Editing notebook ${x}`,
    running: x => `Running: ${x}`, checkingOutput: 'Checking a command’s output', stopping: 'Stopping a command',
    searching: (p, where) => `Searching “${p}”${where ? ` in ${where}` : ''}`, findingFiles: x => `Finding files ${x}`, listing: x => `Listing ${x}`,
    opening: x => `Opening ${x}`, webSearch: x => `Searching the web: ${x}`, launched: x => `Launched agent: ${x}`, agent: 'agent',
    todos: 'Updating the task list', skill: x => `Using skill ${x}`, asking: 'Asking you a question', plan: 'Presenting a plan for approval',
    command: x => `Command ${x}`, handback: 'Handing back its report', tool: 'Tool',
    sbChats: n => `${n} chat${n === 1 ? '' : 's'}`, sbAgents: n => `${n} agent${n === 1 ? '' : 's'}`, sbIdle: 'Claude idle',
    sbWorking: 'working', sbHead: 'Chats working', sbNone: 'No Claude Code chat is working right now.', sbAgentsN: n => `${n} agents`
  },
  es: {
    unknown: 'desconocido', untitled: 'Chat sin título', chat: 'Chat', subagent: 'Subagente',
    starting: 'Iniciando…', thinking: 'Pensando…', writing: 'Escribiendo…', waitingAgents: 'Esperando a sus agentes',
    endedError: 'Terminó con error', agentsBackground: n => `${n} agente${n === 1 ? '' : 's'} trabajando en segundo plano`,
    interrupted: 'Interrumpido por el usuario', reportFrom: x => `Informe de ${x}`, anAgent: 'un agente', bgTaskDone: 'Terminó una tarea en segundo plano',
    reading: x => `Leyendo ${x}`, writingFile: x => `Escribiendo ${x}`, editing: x => `Editando ${x}`, editingNb: x => `Editando notebook ${x}`,
    running: x => `Ejecutando: ${x}`, checkingOutput: 'Revisando la salida de un comando', stopping: 'Deteniendo un comando',
    searching: (p, where) => `Buscando “${p}”${where ? ` en ${where}` : ''}`, findingFiles: x => `Buscando archivos ${x}`, listing: x => `Listando ${x}`,
    opening: x => `Abriendo ${x}`, webSearch: x => `Buscando en la web: ${x}`, launched: x => `Lanzó el agente: ${x}`, agent: 'agente',
    todos: 'Actualizando la lista de tareas', skill: x => `Usando la skill ${x}`, asking: 'Te está haciendo una pregunta', plan: 'Presentando un plan para aprobar',
    command: x => `Comando ${x}`, handback: 'Entregando su informe', tool: 'Herramienta',
    sbChats: n => `${n} chat${n === 1 ? '' : 's'}`, sbAgents: n => `${n} agente${n === 1 ? '' : 's'}`, sbIdle: 'Claude en reposo',
    sbWorking: 'trabajando', sbHead: 'Chats trabajando', sbNone: 'Ningún chat de Claude Code está trabajando ahora.', sbAgentsN: n => `${n} agentes`
  }
}

let lang = 'en'

/** 'auto' | 'en' | 'es' (+ idioma del editor para 'auto') → 'en' | 'es' */
function resolveLang(setting, editorLang) {
  const pick = setting && setting !== 'auto' ? setting : editorLang
  return /^es\b/i.test(String(pick || '')) ? 'es' : 'en'
}

function setLang(l) { lang = STRINGS[l] ? l : 'en' }
function getLang() { return lang }

function t(key, ...args) {
  const v = STRINGS[lang][key] ?? STRINGS.en[key]
  return typeof v === 'function' ? v(...args) : v
}

module.exports = { t, setLang, getLang, resolveLang }
