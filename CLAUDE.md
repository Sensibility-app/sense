# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Sense** is an agent-first self-hosting development environment. The core principle: build a closed loop where all development happens by commanding a local server through a browser UI, with Claude acting as the execution agent.

The system is designed to **write and evolve itself** through structured agent interactions.

## Architecture Philosophy

### Core Loop (Agentic)
1. Browser UI sends task/command
2. Server builds project context (file tree, git status, README)
3. Agent receives context + task, replies with **structured actions** (JSON only)
4. Server executes actions (file system, commands, git)
5. **If actions fail**: Error feedback sent back to agent, loop repeats (max 5 iterations)
6. Results stream back to browser
7. Session logged to `.sense/sessions/`
8. System extends itself through this loop

### Critical Constraint: Structured Output Only

Agent responses MUST be strict JSON with this schema:

```json
{
  "thought_summary": "Brief description",
  "actions": [
    {
      "type": "fs.writeFile",
      "path": "relative/path/file.ts",
      "content": "file contents"
    },
    {
      "type": "proc.exec",
      "cmd": "command to run"
    }
  ],
  "final": "Summary of what was done"
}
```

**Rules:**
- No free-form instructions
- No hidden changes
- Every file change must be explicit in actions array
- Small batches of actions only
- All changes must be diff-visible

## Repository Structure

```
/server         - Core server (Deno + WebSocket)
  main.ts       - HTTP + WebSocket server
  agent.ts      - Claude API integration
  executor.ts   - Agentic task execution with retry loop
  context.ts    - Auto-context builder (file tree, git, README)
  session.ts    - Session logging
  tools.ts      - Action execution (fs, proc, git)
  protocol.ts   - Type definitions and validation
/client         - Browser UI (thin renderer)
  index.html    - UI layout and styles
  client.ts/js  - WebSocket client
/.sense         - Runtime state
  sessions/     - Persistent session logs (JSON)
```

## Tool Set (v0)

### File System
- `fs.readFile` - Read file contents
- `fs.writeFile` - Create or overwrite file
- `fs.listDir` - List directory contents
- `fs.move` - Move/rename files
- `fs.delete` - Delete files

### Process
- `proc.exec` - Execute command with streaming output

### Git
- `git.status` - Show working tree status
- `git.diff` - Show changes

## Development Commands

```bash
# Start server with auto-reload
deno task dev

# Start server (production)
deno task start

# Run tests
deno task test
```

The server requires `ANTHROPIC_API_KEY` in environment or `.env` file.

## Key Development Principles

1. **No Manual Edits**: Once self-hosting is achieved, all changes happen through the browser UI commanding the agent
2. **Auto Context**: Agent automatically receives project file tree, git status, and README
3. **Iterative Execution**: Agent retries up to 5 times if actions fail, learning from errors
4. **Small Steps**: Changes should be small and verifiable
5. **Diff Visibility**: All changes must be reviewable as diffs (use Git Diff button)
6. **Structured Only**: No free-form agent responses - structured actions only
7. **Session Logging**: All tasks logged to `.sense/sessions/` for audit trail

## Current Status: Agentic v0.2

The system now has:
- ✅ Agentic execution with retry loop (up to 5 iterations)
- ✅ Automatic project context injection
- ✅ Session logging to `.sense/sessions/`
- ✅ Error recovery and self-correction
- ✅ Git integration for tracking changes

**Self-Hosting Criteria** (ready to test):
- Agent can add a server endpoint
- Agent can modify the UI
- Agent can run tests/build
- Agent knows it's a Deno project
- No external code editing needed

The system is now ready for **true dogfooding** - command it to improve itself!

## Postponed Features (Do Not Implement Yet)

- Plugin system
- Multi-pane window manager
- Permissions & sandboxing
- MessagePack / performance optimizations
- Fancy editor widgets

These will be added later **through the agent system itself** once the core loop is working.

## Task-Based Development (Phase 3+)

Tasks include:
- Title
- Acceptance criteria
- Status (open/running/done/failed)
- Artifacts (diffs, logs)

Agent workflow for tasks:
1. Restate acceptance criteria
2. Propose plan
3. Execute incrementally
4. Validate via tests/build
5. Mark done

## Success Definition

The system is successful when you can type in the browser:

> "Add a new endpoint and update the UI to show its status"

And the system edits its own code, runs checks, shows diffs, and continues evolving itself.
