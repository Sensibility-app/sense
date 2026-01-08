# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Sense** is a browser-based IDE that integrates Claude's native tool use capabilities. Instead of building a custom agent system, Sense provides an MCP-style tool server that Claude uses to interact with the filesystem and execute commands.

## Architecture: MCP Tool Server + Claude

```
Browser UI ←→ WebSocket Server ←→ Claude API (with tools)
                    ↓
              MCP-style Tools
                    ↓
              Your Filesystem
```

### How It Works

1. User sends task through browser
2. Server calls Claude API with MCP-style tools exposed
3. Claude decides which tools to use and calls them
4. Server executes tools and returns results
5. Claude continues iterating (up to 25 times) until task is complete
6. All tool calls and results stream to browser in real-time

**Key Insight**: We don't build an agent - we provide tools and let Claude be the agent!

## Available Tools

Claude has access to these MCP-style tools:

- **read_file** - Read file contents
- **create_file** - Create new files (auto-creates directories)
- **edit_file** - Edit files by exact string replacement
- **read_file_range** - Read specific line ranges
- **edit_file_range** - Replace line ranges (RECOMMENDED for multi-line edits)
- **list_directory** - List directory contents
- **execute_command** - Run shell commands (git, deno, tests, etc.)
- **search_files** - Search for patterns with grep
- **reload_server** - Trigger server reload

**📖 See [TOOLS.md](TOOLS.md) for complete tool reference with examples and best practices.**

## Repository Structure

```
/server
  main.ts        - HTTP + WebSocket server
  claude.ts      - Claude tool use integration
  tools-mcp.ts   - MCP-style tool definitions
  session.ts     - Session logging
/client
  index.html     - UI layout and styles
  client.js      - WebSocket client
/.sense
  sessions/      - Session logs (JSON)
```

## Development Commands

```bash
# Start server with auto-reload
deno task dev

# Start server (production)
deno task start
```

Requires `ANTHROPIC_API_KEY` in environment or `.env` file.

## Key Principles

1. **Tool-First Design**: Expose capabilities as tools, let Claude figure out how to use them
2. **Claude Handles Agentic Loop**: Claude decides when to continue or stop
3. **Streaming Everything**: Tool calls and results stream to UI in real-time
4. **No Custom Protocols**: Use Anthropic's standard tool use format
5. **Session Logging**: All tasks logged to `.sense/sessions/`

## This is a Deno Project

**IMPORTANT**: Use Deno APIs (Deno.readTextFile, Deno.writeTextFile, etc.), NOT Node.js APIs (fs, path).

## Development Philosophy

Sense is designed to be **self-hosting**: Claude can modify Sense's own code through the tool interface. The system should be able to:
- Read its own source files
- Modify server and client code
- Run tests and checks
- Evolve its own capabilities

## Current Status

✅ MCP-style tool server
✅ Claude native tool use integration
✅ Streaming tool execution
✅ Session logging
✅ Browser-based IDE interface
✅ Comprehensive documentation

Ready for **true self-hosting**: command Claude to improve the IDE itself!

## Documentation

- **[TOOLS.md](TOOLS.md)** - Complete tool reference with examples, limitations, and best practices
- **[README.md](README.md)** - User-facing quick start guide
- **[MOBILE.md](MOBILE.md)** - PWA and mobile device setup
- **[DOCUMENTATION-ANALYSIS.md](DOCUMENTATION-ANALYSIS.md)** - Analysis of documentation coverage and gaps
- **[scripts/README.md](scripts/README.md)** - Development and testing scripts
- **[agent-first-self-hosting-plan.md](agent-first-self-hosting-plan.md)** - Original design document (historical)
