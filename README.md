# Sense

Agent-first self-hosting development environment.

## Quick Start

1. **Set up your API key**:
   ```bash
   cp .env.example .env
   # Edit .env and add your ANTHROPIC_API_KEY
   ```

2. **Run the server**:
   ```bash
   export ANTHROPIC_API_KEY=your_key_here
   deno task dev
   ```

3. **Open your browser**:
   - Navigate to http://localhost:8080
   - Enter tasks in the input box
   - The agent will execute structured actions to fulfill your requests

## Development Commands

```bash
# Start server with auto-reload
deno task dev

# Start server (production)
deno task start

# Run tests
deno task test
```

## How It Works

1. You enter a task in the browser UI
2. Server sends the task to Claude
3. Claude responds with structured JSON actions
4. Server validates and executes each action
5. Results stream back to the browser
6. The system can modify itself through this loop

## Agent Action Protocol

The agent responds with JSON only:

```json
{
  "thought_summary": "What I'm going to do",
  "actions": [
    {"type": "fs.writeFile", "path": "file.ts", "content": "..."},
    {"type": "proc.exec", "cmd": "deno test -A"}
  ],
  "final": "What was accomplished"
}
```

Available actions:
- `fs.readFile`, `fs.writeFile`, `fs.listDir`, `fs.move`, `fs.delete`
- `proc.exec` - run shell commands
- `git.status`, `git.diff` - git operations

## Architecture

- `/server` - Deno server with WebSocket support
  - `main.ts` - HTTP + WebSocket server
  - `agent.ts` - Claude API integration
  - `tools.ts` - Action execution (file system, process, git)
  - `protocol.ts` - Type definitions and validation
- `/client` - Browser UI
  - `index.html` - UI layout
  - `client.ts` - WebSocket client and interaction
- `/.sense` - Runtime state and session logs

## Self-Hosting

Once the system is running, all further development should happen through the browser UI. The agent can modify its own code, run tests, and evolve the system.

## License

MIT
