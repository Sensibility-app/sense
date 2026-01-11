# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Sense** is a browser-based IDE that integrates Claude's native tool use capabilities. Instead of building a custom agent system, Sense provides an MCP-style tool server that Claude uses to interact with the filesystem and execute commands.

## Quick Reference

For architecture details, available tools, repository structure, and development commands, see **[README.md](README.md)**.

### Key Concepts for Claude Code:
- This is an **MCP-style tool server** - Claude API calls tools to interact with the filesystem
- Tools are defined in `/server/tools/` - see **[TOOLS.md](TOOLS.md)** for complete reference
- All tasks stream to the browser in real-time through WebSockets
- Sessions are logged to `.sense/sessions/` for debugging

## Key Principles

1. **Tool-First Design**: Expose capabilities as tools, let Claude figure out how to use them
2. **Claude Handles Agentic Loop**: Claude decides when to continue or stop
3. **Streaming Everything**: Tool calls and results stream to UI in real-time
4. **No Custom Protocols**: Use Anthropic's standard tool use format
5. **Session Logging**: All tasks logged to `.sense/sessions/`

## This is a Deno Project

**IMPORTANT**: Use Deno APIs (Deno.readTextFile, Deno.writeTextFile, etc.), NOT Node.js APIs (fs, path).

## Development Workflow

**Server Management:**
- **IMPORTANT**: The server should already be running at http://localhost:8080
- **DO NOT start/restart the server yourself** unless explicitly asked
- **Hot-reload with validation is ALWAYS enabled** - this is a self-modifying application
- Changes are validated before restart - broken code won't crash the working server

**Available Tasks:**
- `deno task start` - Default mode with validation + hot-reload (use this)
  - Validates TypeScript syntax before restarting
  - Keeps working server alive if new code has errors
  - Watches both `/server/` and `/client/` directories
  - Debounces rapid changes (100ms)
- `deno task start:fast` - Fast restart without validation (for debugging crashes)
  - Uses Deno's built-in --watch
  - Immediately restarts even with syntax errors
  - Only for when you want to see crash behavior

**How Hot-Reload Works:**
- **Server changes:** Full server restart after validation
- **Client changes:** Hot-reload without server restart (faster)
  - TypeScript transpiled automatically
  - Page reloads in browser
  - Deferred if task is running
- **ALL changes auto-reload** - never manually restart

**Why Validation Everywhere:**
In a self-modifying application, Claude may write code with syntax errors. Validation ensures these errors don't take down the running server - instead, you see the error message and the server keeps running with the old code until the error is fixed.

## Testing & Debugging

**WebSocket Test Client:**
Use `ws_client.ts` to test the WebSocket API directly without the browser:

```bash
# Basic usage
deno run --allow-net ws_client.ts "What is 2+2?"

# Clear session before sending
deno run --allow-net ws_client.ts --clear "Start fresh conversation"

# Test thinking blocks
deno run --allow-net ws_client.ts "Solve a complex problem"
```

**Features:**
- Real-time streaming output (thinking blocks shown as 💭)
- Error reporting with clear indicators
- Automatic cleanup and timeout handling
- Token usage display

**When to use:**
- Test API changes without browser
- Verify thinking block streaming
- Debug multi-turn conversations
- Quick functional testing during development

## Historical Files

**DO NOT DELETE**: The following files have historical significance and should be preserved:
- `hello.md` - Historical marker from project contributor (Andrei)
- `hello.txt` - Historical test artifact

These files may appear unused but serve as project history.

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
