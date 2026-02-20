# Sense

A self-modifying AI agent that runs in your browser. Sense can read, write, and reload its own source code while you chat with it.

Built with Deno and vanilla TypeScript. No frameworks, no build step.

## What It Does

Sense is a containerized AI assistant powered by Claude. It has full access to its own codebase and can modify itself on request — editing server logic, updating its UI, adding new tools — all while running.

Every tool is also a `/command`. Type `/help` to see what's available.

### Built-in Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read any file in the project |
| `create_file` | Create a new file |
| `edit_file` | Edit existing files with search/replace |
| `glob` | Find files by pattern |
| `search_files` | Search file contents with regex |
| `eval` | Execute shell commands |
| `web_search` | Search the web |
| `fetch_url` | Fetch and extract web page content |
| `reload_server` | Restart the server after backend changes |
| `reload_client` | Push client updates to the browser |
| `reload_tools` | Load new or modified tools without restart |
| `compact` | Summarize conversation to save context |
| `clear` | Reset the session |

### Adding Tools

Create a file in `server/tools/`, export `definition`, `permissions`, and `executor` using the `createTool()` helper, then call `/reload_tools`. That's it.

## Architecture

```
sense/
├── server/          # Deno backend
│   ├── main.ts      # HTTP + WebSocket server
│   ├── claude.ts    # Claude API (streaming, tool use)
│   ├── file-server.ts   # Static files + TS transpilation
│   ├── tools/       # Tool definitions (each file = one tool)
│   └── websocket-handler.ts
├── client/          # Browser frontend (vanilla TS)
│   ├── client.ts    # Main entry point
│   ├── connection.ts    # WebSocket with auto-reconnect
│   └── renderer.ts  # Markdown rendering + streaming UI
├── shared/          # Types shared between server and client
└── sessions/        # Conversation persistence
```

The server transpiles TypeScript to JavaScript on-the-fly for the browser — no bundler needed.

## Running

Sense is designed to run as a container on the [Sensibility](https://sensibility.app) platform, which handles authentication, LLM proxying, and container orchestration.

For local development:

```bash
deno task start
```

Requires the `llm` import to resolve — either through the Sensibility platform's SDK or by replacing the import map entry in `deno.json`.

## How It Works

1. You type a message or `/command` in the browser
2. The client sends it over WebSocket to the Deno server
3. The server streams a Claude response, executing any tool calls
4. Tool results feed back into Claude for multi-step reasoning
5. All responses stream to the browser in real-time
6. If Sense edits its own code, it calls the appropriate reload tool
7. After a server restart, incomplete tasks auto-resume

## License

MIT
