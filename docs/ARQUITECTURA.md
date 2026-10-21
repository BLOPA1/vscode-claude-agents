# Arquitectura

[English](ARCHITECTURE.md) · **Español**

Este documento explica cómo está hecha la extensión, para quien quiera modificarla o adaptarla.

## Visión general

```text
Archivos de Claude Code (~/.claude)      ← solo lectura, nunca se modifican
        │  se releen cada ~2 s (solo los bytes nuevos)
        ▼
Extension host (Node.js)                  ← lee, interpreta y arma un "snapshot"
        │  postMessage(snapshot)
        ▼
Webview (HTML/CSS/JS)                     ← dibuja Resumen, Chats, mapa y actividad
        │  postMessage({ type: 'select', chatId, nodeId })
        └──────────────► vuelve al extension host
```

La extensión no se conecta a Claude Code. Claude Code ya escribe en disco todo lo que hace cada chat y cada subagente. La extensión lee esos archivos, deduce el estado y se lo pasa a la vista.

Toda la lógica de `lib/` es Node puro y no importa `vscode`, así que se puede probar con `node` y datos falsos (`scripts/demo.js`). Solo `extension.js` usa la API del editor.

## Fuentes de datos

### Chats

Están en `~/.claude/projects/<carpeta-del-proyecto>/<id-de-sesión>.jsonl`. Es formato JSONL: un objeto JSON por línea, y las líneas nuevas se agregan al final. Los campos que importan:

```jsonc
{ "type": "user" | "assistant" | "system" | "ai-title" | ...,
  "timestamp": "2026-10-21T14:00:00Z",
  "cwd": "/home/dev/proyectos/mi-app",
  "entrypoint": "claude-vscode",          // IDE; "cli" = terminal; "sdk-*"
  "isSidechain": false,
  "origin": { "kind": "task-notification" },   // avisos del propio Claude Code
  "message": {
    "id": "msg_...", "model": "claude-opus-5-5",
    "usage": { "input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens" },
    "content": [
      { "type": "text", "text": "..." },
      { "type": "tool_use", "id": "toolu_1", "name": "Read", "input": { "file_path": "..." } },
      { "type": "tool_result", "tool_use_id": "toolu_1", "is_error": false }   // en líneas "user"
    ]
  },
  "toolUseResult": { "agentId": "a07", "status": "completed", "totalTokens": 6900 }  // resultado de un Agent
}
```

### Subagentes

Están en `~/.claude/projects/<proyecto>/<id-de-sesión>/subagents/agent-<id>.jsonl` y tienen el mismo formato que los chats. Al lado está `agent-<id>.meta.json`, con `agentType`, `description` y `requestShape` (primer o segundo plano).

### Cuenta

Sale de `~/.claude.json` → `oauthAccount` (`emailAddress`, `displayName`, `organizationName`, `organizationRole`). Solo se lee ese campo, nunca tokens ni credenciales.

## Módulos

### `lib/sessions.js`: descubridor de chats

- Recorre `projects/*/*.jsonl` y se queda con los modificados en las últimas 24 h.
- Lee solo los primeros 64 KB (`cwd`, `entrypoint`, primer prompt) y los últimos 160 KB (título, estado) de cada archivo, con caché por tamaño y fecha.
- Cuenta los archivos de `subagents/`. Los modificados en los últimos 2 minutos cuentan como activos.
- También mira la fecha de la carpeta `subagents`, porque un chat puede estar quieto mientras sus agentes trabajan.

### `lib/reader.js`: lector incremental

Por cada archivo recuerda hasta qué byte leyó y en cada pasada procesa solo lo nuevo, con un stream. La última línea incompleta queda guardada para la próxima pasada. Si el archivo se achicó, empieza de cero.

Línea por línea mantiene:

- **Actividad reciente** (120 entradas): cada `tool_use` entra como pendiente y se marca hecha cuando llega su `tool_result`.
- **Tokens**: el contexto actual es `input + cache_read + cache_creation` del último mensaje. La salida se acumula deduplicada por `message.id`.
- **Llamadas a `Agent`/`Task`**: descripción, tipo, si van en segundo plano y su resultado.
- La última lista `TodoWrite`, el modelo, el título y los totales por día.

### Derivador de estado (`deriveStatus` en `reader.js`)

Es una función pura que decide el estado a partir de la última entrada significativa:

| Última entrada | Estado |
|---|---|
| `tool_use` sin resultado | **Trabajando**, con esa herramienta |
| `tool_use` sin resultado hace más de 30 s (excepto Bash, Agent y Web) | **¿Esperando aprobación?** |
| `tool_result` o prompt del usuario reciente | **Pensando** |
| Texto del asistente con más de 5 s de antigüedad | **Terminado** (subagente) o **Esperando tu mensaje** (chat principal) |
| `system` con `stop_hook_summary`/`turn_duration`, o "[Request interrupted" | **Terminado** |
| Resultado de `SubagentHandback` (el subagente entregó su informe) | **Terminado** |
| Nada nuevo en más de 30 min | **Sin actividad** |

Para los subagentes hay reglas extra:

- Si la llamada en el chat principal tiene `status: "completed"`, eso manda sobre todo lo demás.
- Un agente en segundo plano devuelve al principio un resultado del tipo "lanzado", que **no** significa que terminó. El fin llega después, como un mensaje con `origin.kind = "task-notification"` (o como la entrega del informe, `origin.kind = "peer"` con `handback`). En ese momento se marca la llamada como terminada.

### Enlazador de agentes (`buildDetail` en `snapshot.js`)

Une cada `agent-<id>.jsonl` con su llamada `Agent` en el chat principal:

1. Primero intenta por `toolUseResult.agentId`.
2. Si el agente todavía corre y no hay resultado, empareja por la `description` del `.meta.json`.
3. Las llamadas `Agent` que todavía no tienen archivo se muestran como "Iniciando…".

### `lib/describe.js` y `lib/i18n.js`

`describe.js` es una tabla que traduce `name + input` de cada herramienta a una frase legible: "Leyendo src/x.ts", "Ejecutando: npm test", "Buscando 'patrón' en src", "MCP servidor · tool", etc. Las frases salen de `i18n.js`, que tiene los textos en inglés y español del lado del host.

Las frases se generan al leer cada línea. Por eso, al cambiar el idioma, la extensión crea un recolector nuevo para que todo se relea en el idioma elegido.

### `lib/snapshot.js`: recolector

En cada pasada:

1. Escanea las sesiones, que es barato.
2. Arma el detalle completo solo de los chats abiertos en alguna vista.
3. Calcula los totales de hoy con menos frecuencia (cada 20 s).
4. Devuelve un único objeto.

Los lectores viven en una caché LRU (200) y las pasadas se encadenan, así que nunca hay dos leyendo el mismo archivo a la vez.

## Modelo de datos (snapshot)

```js
{
  now,
  account: { name, email, org, role, version },
  today:   { chats, agents, output, tools, models: { "claude-opus-5-5": 102 } },
  totals:  { running, agentsActive, waiting },          // para la barra de estado
  chats: [ { id, title, project, source, model, status, action,
             running, agentsActive, agentsTotal, updatedAt } ],
  details: {                                            // solo chats abiertos en una vista
    "<chatId>": { main: Node, agents: [Node], todos, prompts, working }
  }
}

Node = { id, kind: 'main' | 'agent', title, agentType, background,
         status, action, startedAt, endedAt, tokens, output, tools, model, prompt,
         feed: [ { kind: 'tool' | 'text' | 'prompt' | 'notify' | 'interrupt', name, text, at, endAt, done, error } ] }
```

El `feed` va completo (80 entradas) solo para el nodo seleccionado. El resto de los nodos lleva solo las últimas entradas, para la vista previa dentro del mapa.

## `extension.js`

- **Vista lateral**: un `viewsContainers.activitybar` y una vista `webview`, registrada con `retainContextWhenHidden`.
- **Pestaña del editor**: `createWebviewPanel` en `ViewColumn.Beside`, con el mismo HTML y los mismos mensajes.
- **Barra de estado**: `$(sync~spin) 2 chats · 3 agentes`, con fondo de advertencia si algo espera aprobación.
- **Idioma**: el ajuste `claudeAgents.language` o, en `auto`, el del editor (`vscode.env.language`). Los textos del manifiesto (comandos, ajustes) salen de `package.nls.json` y `package.nls.es.json`.
- **Sondeo**: un `setInterval`. Si una pasada no terminó, no se lanza otra: se marca "repetir al terminar".
- **Mensajes desde la vista**:

  | Mensaje | Qué hace el host |
  |---|---|
  | `select` | Guarda qué chat y qué nodo mira esa vista y dispara una pasada. |
  | `openFile` | Abre un transcript, solo si la ruta real está dentro del directorio de Claude y termina en `.jsonl`. |
  | `popout` | Abre la pestaña del editor. |

## Webview

- **Sin frameworks**: HTML, CSS y JS planos.
- **Seguridad**: CSP con nonce. Todo el texto de los transcripts se escapa antes de ir al HTML.
- **Colores**: solo variables del tema (`--vscode-*`), así que se adapta a temas claros, oscuros y de alto contraste.
- **Íconos**: SVG de trazo embebidos que heredan el color con `currentColor`.
- **Textos**: un diccionario en inglés y español al inicio de `panel.js`. El idioma llega en cada snapshot (`snapshot.lang`).
- **Mapa de agentes**: hecho con CSS puro. Con una *container query* pasa de árbol vertical (sidebar angosto) a diagrama de izquierda a derecha (pestaña ancha).
- **Tiempo real**:
  - Se redibuja al llegar cada snapshot, conservando el scroll y los `<details>` abiertos.
  - No se redibuja mientras el usuario mantiene apretado el mouse.
  - Los contadores ("hace 5 s", "lleva 2m 10s") se actualizan cada segundo sin pedir datos nuevos.

## Riesgos conocidos

- **El formato puede cambiar.** Los transcripts son internos de Claude Code. El parseo está aislado en `reader.js` y `sessions.js`, así que si el formato cambia solo hay que tocar ahí.
- **La aprobación es una deducción.** "Esperando aprobación" se infiere por tiempo, no es un dato real.
- **Sub-subagentes.** Se cuentan, pero no se dibujan como un nivel extra del árbol.
