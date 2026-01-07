# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Sense** is an agent-first self-hosting development environment. The core principle: build a closed loop where all development happens by commanding a local server through a browser UI, with Claude acting as the execution agent.

The system is designed to **write and evolve itself** through structured agent interactions.

## Architecture Philosophy

### Core Loop
1. Browser UI sends task/command
2. Server routes to Agent (Claude)
3. Agent replies with **structured actions** (JSON only)
4. Server executes actions (file system, commands, git)
5. Results stream back to browser
6. System extends itself through this loop

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
/server       - Core server (Deno/Node + WebSocket)
  agent.ts    - Agent coordination
  tools.ts    - Tool execution (fs, proc, git)
  protocol.ts - JSON schema validation
  websocket.ts - Client communication
/client       - Browser UI (thin renderer)
  index.html
  client.ts
/.sense       - Runtime state
  sessions/   - Persistent session logs
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

**Note:** Commands will be established once initial bootstrap is complete. During bootstrap phase, the system will be built to define its own development workflow.

Initial development targets:
- Start server: `deno run -A server/main.ts` (or equivalent)
- Run tests: `deno test -A` (or equivalent)
- Build client: TBD based on chosen tooling

## Key Development Principles

1. **No Manual Edits**: Once self-hosting is achieved, all changes happen through the browser UI commanding the agent
2. **Explicit Context**: Agent must be given all necessary context to make decisions
3. **Small Steps**: Changes should be small and verifiable
4. **Diff Visibility**: All changes must be reviewable as diffs
5. **Structured Only**: No free-form agent responses - structured actions only

## Self-Hosting Flip Criteria

The system becomes self-hosting when:
- Agent can add a server endpoint
- Agent can modify the UI
- Agent can run tests/build
- Agent can show diffs in browser
- No external code editing needed

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
