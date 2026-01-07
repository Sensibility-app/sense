# Agent‑First Self‑Hosting Development Plan

This document describes a **from‑scratch, agent‑first bootstrap plan** for building a minimal system that can rapidly become capable of **writing and evolving itself**.

The goal is to reach a point where **all further development happens by commanding a local server through a browser UI**, with Claude connected to that server as an agent.

---

## Core Principle

You are not building an IDE first.

You are building a **closed loop**:

1. Browser UI sends a task / command
2. Server routes it to an Agent (Claude)
3. Agent replies with **structured actions**
4. Server executes actions (FS, commands, git)
5. Results stream back to the browser
6. The system is then used to extend itself

Once this loop works, *everything else becomes a refactor*.

---

## Phase 0 — Define the Absolute Minimum (Kickstart v0)

### Required to be self‑hosting
The initial version **must** support:

- File system write/read/delete/move
- Command execution with streaming output
- Git status + diff visibility
- Persistent session / task log
- Browser UI as the **only control surface**

### Explicitly postponed
- Plugin system
- Multi‑pane window manager
- Permissions & sandboxing
- MessagePack / performance optimizations
- Fancy editor widgets

---

## Phase 1 — Bootstrap via Claude Console

Claude Console is used **once** to generate the initial repo.

### Repo Structure

```
/server
  agent.ts
  tools.ts
  protocol.ts
  websocket.ts
/client
  index.html
  client.ts
/.sense
  sessions/
README.md
```

---

## Server (Core‑Lite)

**Runtime**: Deno or Node  
**Transport**: WebSocket + JSON

### Responsibilities

- Maintain global state:
  - sessions
  - tasks
  - last command output
  - last diff
- Accept browser events
- Call Claude with task + context
- Validate and execute agent actions
- Stream logs and diffs back to client

---

## Agent Action Protocol (Critical)

Claude must output **strict JSON only**.

### Example

```json
{
  "thought_summary": "Add health endpoint",
  "actions": [
    {
      "type": "fs.writeFile",
      "path": "server/health.ts",
      "content": "export const health = () => 'ok';"
    },
    {
      "type": "proc.exec",
      "cmd": "deno test -A"
    }
  ],
  "final": "Health endpoint added and tested"
}
```

### Rules

- No free‑form instructions
- No hidden changes
- Every file change must be explicit
- Server rejects invalid schemas
- Small batches of actions only

---

## Tool Set (v0)

### File system
- fs.readFile
- fs.writeFile
- fs.listDir
- fs.move
- fs.delete

### Process
- proc.exec (stream stdout/stderr)

### Git (wrappers or proc.exec)
- git.status
- git.diff

---

## Browser Client (Thin Renderer)

Single‑page UI:

- Task input box
- Log/output stream
- Diff viewer (unified diff is fine)
- Buttons:
  - Run tests
  - Show git diff
  - Retry task

No business logic lives here.

---

## Phase 2 — Flip to Dogfooding

Stop editing code manually.

All changes happen by:

1. Opening browser
2. Entering a task
3. Letting the agent modify the repo
4. Reviewing diffs & logs
5. Iterating

### Flip Criteria (must all work)

- Agent can add a server endpoint
- Agent can modify the UI
- Agent can run tests/build
- Agent can show diffs in browser
- No console‑Claude needed anymore

---

## Phase 3 — Task‑Based Agent Control

Upgrade from chat to **Tasks**.

Each task includes:

- Title
- Acceptance criteria
- Status (open / running / done / failed)
- Artifacts (diffs, logs)

Agent workflow:

1. Restate acceptance criteria
2. Propose plan
3. Execute incrementally
4. Validate via tests/build
5. Mark task done

---

## Phase 4 — Gradual Evolution Toward Full Architecture

### Declarative UI Tree
Server sends UI trees:

```json
{
  "type": "app",
  "children": [
    { "type": "panel", "id": "chat" },
    { "type": "panel", "id": "output" }
  ]
}
```

Client becomes a renderer only.

---

### Promote Tools → Functions

Replace raw tools with namespaced calls:

- core.fs.writeFile
- core.proc.exec
- plugin.git.status

Enables future plugins without rewrites.

---

### Permissions (Later)

Initially trust local dev.

Later:
- Allowed command lists
- Path sandboxing
- Capability‑based tool exposure

---

## Non‑Negotiable Constraints

1. Structured agent output only
2. All changes are diff‑visible
3. No manual edits outside the system
4. Explicit context packaging
5. Small, verifiable steps

---

## Definition of Success

You can open the browser and type:

> “Add a new endpoint and update the UI to show its status”

And the system:
- edits its own code
- runs checks
- shows diffs
- continues evolving itself

At that point, the system is **agent‑first and self‑hosting**.
