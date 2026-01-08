# Sense Development Scripts

## dev-with-validation.ts - Safe Development Server

A development server wrapper that validates TypeScript syntax before restarting. Prevents breaking the running server with syntax errors.

### Usage

```bash
deno task dev
```

This is now the default development mode. The script:
1. Watches `./server` and `./client` directories for changes
2. Validates TypeScript syntax with `deno check` before restarting
3. **Keeps the current working server running** if validation fails
4. Shows clear error messages so you can fix syntax issues
5. Auto-restarts once files are valid

### Features

- **Syntax Validation**: Won't restart with TypeScript errors
- **Safety Net**: Current server stays alive during failed reloads
- **Debouncing**: Waits 100ms for multiple rapid changes
- **Editor Compatibility**: Ignores temp files (.swp, .tmp, etc.)
- **Clear Feedback**: Shows validation status and errors

### Commands

- `deno task dev` - Safe development mode (recommended)
- `deno task dev:unsafe` - Direct `--watch` mode (no validation)
- `deno task start` - Production mode (no watching)

### Why This Exists

During development, Claude (or you) might save files with syntax errors. Without validation, `--watch` immediately kills the server, leaving you with no running instance. This script prevents that by validating first.

## ws-test.ts - WebSocket Test Client

A command-line tool for testing Sense server functionality via WebSocket.

### Usage

```bash
deno run --allow-net scripts/ws-test.ts [--clear] ["task description"]
```

### Options

- `--clear`, `-c` - Clear the session before running the test
- `--help`, `-h` - Show help message

### Examples

```bash
# Run with default task
deno run --allow-net scripts/ws-test.ts

# Clear session first, then run default task
deno run --allow-net scripts/ws-test.ts --clear

# Run custom task with existing session
deno run --allow-net scripts/ws-test.ts "List files in server directory"

# Clear session and run custom task
deno run --allow-net scripts/ws-test.ts --clear "Read client/index.html"

# Test file operations
deno run --allow-net scripts/ws-test.ts --clear "Show me the first 30 lines of server/claude.ts"

# Test search functionality
deno run --allow-net scripts/ws-test.ts "Search for 'executeTool' in server directory"
```

### Features

- **Session Management**: Optionally clear session before each test
- **Real-time Streaming**: Shows tool use and results as they happen
- **Color-coded Output**: Different message types are visually distinct
- **Tool Parameter Visibility**: See exactly what parameters Claude sends to tools
- **Auto-timeout**: Exits after 30 seconds if task doesn't complete

### Output Format

- 📊 SESSION_INFO - Session state and history count
- 👤 USER - User message sent to Claude
- 🤖 ASSISTANT START - Claude begins responding
- 🔧 TOOL USE - Claude calls a tool (with parameters)
- ✅ TOOL RESULT - Tool execution result
- 💬 SYSTEM - System messages
- ⚙️ Processing - Task processing status

### Use Cases

1. **Debug Tool Execution**: See exactly what parameters Claude is sending
2. **Test Changes**: Verify server changes work correctly
3. **Reproduce Issues**: Isolate and reproduce bugs with specific tasks
4. **Session Testing**: Test with fresh session (`--clear`) or with history
5. **Performance Testing**: Measure task completion time
