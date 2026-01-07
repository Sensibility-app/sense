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
   deno task dev
   ```

3. **Open your browser**:
   - Navigate to http://localhost:8080
   - Enter tasks like "add a clear button to the UI"
   - Watch Claude use tools to complete the task autonomously

## How It Works

Sense doesn't build a custom agent - it provides **MCP-style tools** that Claude uses through its native tool use API:

```
Browser ←→ Server ←→ Claude (with tools) ←→ Your Filesystem
```

**Available Tools:**
- `read_file` - Read any file
- `write_file` - Create/modify files
- `list_directory` - Browse directories
- `execute_command` - Run shell commands
- `search_files` - Search with grep

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
# Start with auto-reload
deno task dev

# Run tests (when available)
deno task test
```

## Project Structure

- `/server` - Deno WebSocket server with Claude integration
- `/client` - Browser UI (HTML/CSS/JS)
- `/.sense/sessions` - Task execution logs

## Self-Hosting

Once running, you can command Claude to improve Sense itself:

```
Read server/claude.ts and suggest improvements to the tool execution loop

Add a new tool called 'git_commit' that stages and commits changes

Update the UI to show a progress indicator during task execution
```

The system can evolve itself through the same interface you use to build other projects.

## License

MIT
