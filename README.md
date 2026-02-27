# Sense

A self-modifying AI agent that runs in your browser. Sense can read, write, and reload its own source code while you chat with it.

Built with Deno and vanilla TypeScript. No frameworks, no build step.

## What It Does

Sense is a containerized AI assistant that can modify itself. It has full access to its own codebase and can edit server logic, update its UI, and add new tools — all while running.

Every tool is also a `/command`. Type `/help` to see what's available.

### Built-in Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read any file in the project |
| `create_file` | Create a new file |
| `edit_file` | Edit existing files with search/replace |
| `write_file` | Overwrite an existing file with new content |
| `glob` | Find files by pattern |
| `search_files` | Search file contents with regex |
| `eval` | Execute shell commands |
| `fetch_url` | Fetch and extract web page content |
| `browse` | Browser automation via headless Chrome |
| `talk` | Send messages to sibling Sense apps |
| `notes` | Persistent long-term memory (survives restarts and compaction) |
| `compact` | Summarize conversation to save context |
| `clear` | Reset the session |
| `reload_server` | Restart the server after backend changes |
| `reload_client` | Push client updates to the browser |
| `reload_tools` | Load new or modified tools without restart |
| `help` | List available tools and commands |

### Adding Tools

Create a file in `server/tools/`, export `definition` and `executor` using the `createTool()` helper, then call `/reload_tools`:

```typescript
import { createTool, type ToolResult } from "./_shared/tool-utils.ts";

export const { definition, executor } = createTool(
  {
    name: "my_tool",
    description: "What this tool does",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The input" },
      },
      required: ["query"],
    },
  },
  async (input): Promise<ToolResult> => {
    const query = input.query as string;
    return { content: `Result for: ${query}`, isError: false };
  },
);
```

### Platform SDKs

Sense containers have access to platform SDKs via import map:

| SDK | What It Does | Provided By |
|-----|-------------|-------------|
| `think` | LLM client (chat, streaming) | LLM Proxy service |
| `talk` | Inter-app messaging (discover, send) | Main App service |
| `browse` | Headless browser automation | Browser Proxy service |

<details>
<summary>Architecture</summary>

```
sense/
├── server/          # Deno backend
│   ├── main.ts      # HTTP server (SSE + REST API)
│   ├── agent.ts     # Agentic loop (streaming, parallel tool execution, context management)
│   ├── file-server.ts   # Static files + TS transpilation
│   └── tools/       # Tool definitions (each file = one tool)
├── client/          # Browser frontend (vanilla TS)
│   ├── client.ts    # Main entry point
│   ├── connection.ts    # SSE + fetch with auto-reconnect
│   └── renderer.ts  # Markdown rendering + streaming UI
├── shared/          # Types shared between server and client
├── sessions/        # Conversation persistence
├── SYSTEM.md        # Agent system prompt
└── NOTES.md         # Agent persistent memory (auto-managed)
```

The server transpiles TypeScript to JavaScript on-the-fly for the browser — no bundler needed.

</details>

## How It Works

1. You type a message or `/command` in the browser
2. The server streams an LLM response with extended thinking, executing tool calls in parallel
3. Tool results feed back into the LLM for multi-step reasoning
4. Old tool results are automatically cleared and context is auto-compacted when it grows large
5. The agent maintains persistent memory in `NOTES.md` across conversation resets
6. If Sense edits its own code, it calls the appropriate reload tool
7. After a server restart, incomplete tasks auto-resume

## Running

Sense runs as a container on the [Sensibility](https://sensibility.app) platform, which handles authentication, LLM proxying, and container orchestration.

For local development:

```bash
deno task start
```

Requires the platform SDK imports to resolve — either through the Sensibility platform or by replacing the import map entries in `deno.json`.

## License

MIT
