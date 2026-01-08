# Sense Development Scripts

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
