# Sense

A browser-based IDE that integrates Claude's native tool use capabilities for self-hosting development.

## Quick Start

1. **Set up your API key**:
   ```bash
   cp .env.example .env
   # Edit .env and add your ANTHROPIC_API_KEY
   ```

2. **Run the server**:
   ```bash
   deno task start
   ```
   > 💡 Validation + hot-reload enabled - broken code won't crash the server

3. **Open your browser**:
   - Navigate to http://localhost:8080
   - Enter tasks like "add a clear button to the UI"
   - Watch Claude use tools to complete the task autonomously

## ⚠️ Security Notice

**IMPORTANT:** If you cloned this repository before January 2026, an API key may have been exposed in git history.

**Action Required:**
1. 🔄 **Rotate your Anthropic API key** at https://console.anthropic.com/
2. 🔒 Never commit `.env` files (already in `.gitignore`)
3. 🏠 Only run Sense on localhost or trusted private networks

Sense is a **single-user development tool** with no authentication. See [SECURITY.md](SECURITY.md) for complete security information.

## How It Works

Sense doesn't build a custom agent - it provides **MCP-style tools** that Claude uses through its native tool use API:

```
Browser ←→ Server ←→ Claude (with tools) ←→ Your Filesystem
```

**Available Tools:**
- `read_file` / `read_file_range` - Read files
- `create_file` / `edit_file` / `edit_file_range` - Create/modify files
- `list_directory` - Browse directories
- `execute_command` - Run shell commands
- `search_files` - Search with grep
- `reload_server` - Restart server

**📖 See [TOOLS.md](TOOLS.md) for complete reference**

Claude decides which tools to use, when to use them, and iterates up to 25 times until the task is complete.

## Example Tasks

```
Add a dark mode toggle to the UI

Create a health check endpoint at /health that returns JSON with uptime

Add input validation to prevent empty tasks

Search for TODOs in the codebase and create a todo.md file
```

## Architecture Benefits

✅ **Simple**: Let Claude handle the agentic loop
✅ **Powerful**: Full filesystem and command access
✅ **Transparent**: See every tool call in real-time
✅ **Self-Hosting**: Claude can modify Sense's own code
✅ **Standard**: Uses Anthropic's tool use format (MCP-compatible)

## Development

```bash
# Start server (validation + hot-reload)
deno task start

# Fast mode (no validation, for debugging crashes)
deno task start:fast

# Run tests (when available)
deno task test
```

**Validation is always enabled by default** - Sense is self-modifying, so syntax errors are caught before restart to keep the working server alive.

### TypeScript Client Architecture

The client code is written in **TypeScript** (`client/client.ts`) and automatically transpiled to JavaScript in-memory by the server.

**How It Works:**
1. Browser requests `/client/client.js`
2. Server reads `client/client.ts` from disk
3. Server transpiles TypeScript → JavaScript in-memory (using TypeScript compiler)
4. Server caches result (keyed by source code hash)
5. Server serves JavaScript to browser
6. On next request: serves cached version if source unchanged

**Key Features:**
- ✅ **Zero-build deployment**: No pre-compilation required, `git pull && restart` works immediately
- ✅ **In-memory transpilation**: ~115ms first load, <10ms cached
- ✅ **Hash-based caching**: Only re-transpiles when source changes
- ✅ **Claude-friendly**: Agent can edit TypeScript sources directly without build awareness
- ✅ **Safe fallback**: If transpilation fails, serves last known good version

**File Organization:**
- `client/client.ts` - TypeScript source (committed to git, edit this)
- `client/client.js` - JavaScript output (NOT committed, generated in-memory)
- Cache cleared automatically on server restart

**Development Flow:**
```
Edit client.ts → Save → Server restarts → Cache cleared →
Next request transpiles → Browser receives new JavaScript
```

## Project Structure

- `/server` - Deno WebSocket server with Claude integration
- `/client` - Browser UI (HTML/CSS/TypeScript)
- `/.sense/sessions` - Task execution logs

## Self-Hosting

Once running, you can command Claude to improve Sense itself:

```
Read server/claude.ts and suggest improvements to the tool execution loop

Add a new tool called 'git_commit' that stages and commits changes

Update the UI to show a progress indicator during task execution
```

The system can evolve itself through the same interface you use to build other projects.

## Documentation

- **[SECURITY.md](SECURITY.md)** - Security model, limitations, and best practices
- **[TOOLS.md](TOOLS.md)** - Complete tool reference with examples and best practices
- **[CLAUDE.md](CLAUDE.md)** - Instructions for Claude Code when working with this repo
- **[MOBILE.md](MOBILE.md)** - PWA setup for mobile devices
- **[scripts/README.md](scripts/README.md)** - Development scripts documentation

## License

MIT
