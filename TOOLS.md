# Sense Tool Reference

Complete reference for all tools available to Claude in the Sense development environment.

## Table of Contents

- [Overview](#overview)
- [File System Tools](#file-system-tools)
  - [read_file](#read_file)
  - [create_file](#create_file)
  - [edit_file](#edit_file)
  - [read_file_range](#read_file_range)
  - [edit_file_range](#edit_file_range)
- [Directory Tools](#directory-tools)
  - [list_directory](#list_directory)
- [Execution Tools](#execution-tools)
  - [execute_command](#execute_command)
  - [search_files](#search_files)
- [System Tools](#system-tools)
  - [reload_server](#reload_server)
- [Best Practices](#best-practices)
- [Limitations](#limitations)
- [Error Handling](#error-handling)

---

## Overview

Sense provides MCP-style tools that expose filesystem, command execution, and system capabilities to Claude. All tools:

- Work with paths relative to project root
- Return structured results (content + error flag)
- Have size/output limits to prevent context explosion
- Are sandboxed to prevent path traversal attacks

**Tool Categories:**
- 🗂️ **File System** - Read, create, edit files
- 📁 **Directory** - List directory contents
- ⚡ **Execution** - Run commands, search files
- ⚙️ **System** - Server control

---

## File System Tools

### read_file

Read the complete contents of a file.

**Parameters:**
- `path` (required): Path to file relative to project root

**Returns:** File contents as string

**Limitations:**
- Files larger than 10,000 characters are truncated
- Truncation message shows total file size

**Examples:**

```json
// Read server file
{
  "path": "server/claude.ts"
}

// Read client file
{
  "path": "client/index.html"
}

// Read config
{
  "path": ".env.example"
}
```

**Use When:**
- Reading small to medium files (<10K chars)
- Need complete file contents
- Analyzing configuration files

**Avoid When:**
- Reading very large files (use `read_file_range` instead)
- Only need specific lines (use `read_file_range`)

---

### create_file

Create a new file with content. **Fails if file already exists.**

**Parameters:**
- `path` (required): Path to new file relative to project root
- `content` (required): Content to write to file

**Returns:** Success message

**Features:**
- Automatically creates parent directories if needed
- Fails safely if file exists (prevents accidental overwrites)

**Examples:**

```json
// Create new TypeScript file
{
  "path": "server/new-module.ts",
  "content": "export function newFunction() {\n  return 'hello';\n}"
}

// Create nested file (creates directories automatically)
{
  "path": "server/utils/helpers.ts",
  "content": "// Helper functions\n"
}

// Create config file
{
  "path": ".gitignore",
  "content": "node_modules/\n.env\n"
}
```

**Use When:**
- Creating brand new files
- Want to ensure file doesn't exist
- Creating nested directory structures

**Errors:**
- If file exists: "File {path} already exists. Use edit_file_range or edit_file to modify existing files."

---

### edit_file

Edit an existing file by replacing exact string matches. **For small, precise edits only.**

**Parameters:**
- `path` (required): Path to file relative to project root
- `old_string` (required): Exact string to find (including whitespace)
- `new_string` (required): String to replace with

**Returns:** Success message

**Limitations:**
- `old_string` must match EXACTLY (including all whitespace, indentation, line breaks)
- Only replaces first occurrence
- Fails if string not found
- Sensitive to auto-formatting changes

**Examples:**

```json
// Change variable value
{
  "path": "server/main.ts",
  "old_string": "const PORT = 8080;",
  "new_string": "const PORT = 3000;"
}

// Update import
{
  "path": "server/claude.ts",
  "old_string": "import { TOOLS } from \"./tools-mcp.ts\";",
  "new_string": "import { TOOLS, executeTool } from \"./tools-mcp.ts\";"
}
```

**Use When:**
- Single-line changes
- Exact string is known and unique
- Quick small edits

**Avoid When:**
- Multi-line changes (use `edit_file_range`)
- Uncertain about exact whitespace
- String might have changed due to formatting

**Errors:**
- If file not found: "File {path} not found. Use create_file to create new files."
- If string not found: "String not found in {path}. Make sure old_string matches exactly (including whitespace). Consider using edit_file_range for more reliable editing."

---

### read_file_range

Read specific line range from a file. **More efficient than reading entire large files.**

**Parameters:**
- `path` (required): Path to file relative to project root
- `start_line` (required): Starting line number (1-indexed, inclusive)
- `end_line` (required): Ending line number (1-indexed, inclusive), or -1 for end of file

**Returns:** Lines with line numbers (cat -n format)

**Examples:**

```json
// Read first 20 lines
{
  "path": "server/tools-mcp.ts",
  "start_line": 1,
  "end_line": 20
}

// Read specific function (lines 100-150)
{
  "path": "server/claude.ts",
  "start_line": 100,
  "end_line": 150
}

// Read from line 50 to end of file
{
  "path": "client/client.js",
  "start_line": 50,
  "end_line": -1
}
```

**Use When:**
- Reading large files
- Inspecting specific sections
- Analyzing specific functions or blocks
- Finding context around a line number

**Errors:**
- If start_line exceeds file length: "start_line {n} exceeds file length ({m} lines)"

---

### edit_file_range

**⭐ RECOMMENDED: Most reliable editing method**

Replace specific line range with new content. **Works even if file was auto-formatted.**

**Parameters:**
- `path` (required): Path to file relative to project root
- `start_line` (required): Starting line number to replace (1-indexed, inclusive)
- `end_line` (required): Ending line number to replace (1-indexed, inclusive)
- `new_content` (required): New content to replace the specified lines

**Returns:** Success message with count of replaced lines

**Features:**
- Most reliable editing method
- Not affected by whitespace changes
- Safe for multi-line changes
- Can replace multiple lines with single line (or vice versa)

**Examples:**

```json
// Replace function implementation (lines 45-52)
{
  "path": "server/tools-mcp.ts",
  "start_line": 45,
  "end_line": 52,
  "new_content": "function improvedFunction() {\n  // New implementation\n  return result;\n}"
}

// Replace single line (same as edit_file but more reliable)
{
  "path": "server/main.ts",
  "start_line": 10,
  "end_line": 10,
  "new_content": "const PORT = 3000;"
}

// Replace entire section
{
  "path": "README.md",
  "start_line": 1,
  "end_line": 15,
  "new_content": "# New Title\n\nUpdated introduction...\n"
}
```

**Workflow:**
1. Use `read_file_range` to see the lines you want to edit
2. Note the line numbers
3. Use `edit_file_range` to replace those exact lines

**Use When:**
- Multi-line changes
- Refactoring functions
- Replacing code blocks
- Any edit where exact string match is uncertain

**Errors:**
- If file not found: "File {path} not found. Use create_file to create new files."
- If line range invalid: "start_line {n} is out of range (file has {m} lines)"
- If end_line < start_line: "end_line {n} is out of range (must be >= start_line and <= {m})"

---

## Directory Tools

### list_directory

List files and directories in a given path. **Directories are marked with trailing /**

**Parameters:**
- `path` (optional): Path to directory relative to project root. Defaults to '.' (current directory)

**Returns:** Sorted list (directories first, then files alphabetically)

**Limitations:**
- Maximum 500 entries shown
- If more than 500 entries, list is truncated with warning

**Examples:**

```json
// List root directory
{
  "path": "."
}
// or simply: {}  (path defaults to '.')

// List server directory
{
  "path": "server"
}

// List nested directory
{
  "path": "client/components"
}
```

**Output Format:**
```
Directories end with /. To explore a directory, call list_directory with its path (e.g., "client" or "server").

.sense/
client/
scripts/
server/
.env
.gitignore
README.md
```

**Use When:**
- Exploring project structure
- Finding files in a directory
- Checking what exists before creating files

**Pro Tip:** Progressive exploration
1. List root: `{"path": "."}`
2. See `server/` directory
3. Explore it: `{"path": "server"}`
4. See `server/utils/` directory
5. Explore further: `{"path": "server/utils"}`

---

## Execution Tools

### execute_command

Execute a shell command in the project directory. **Returns stdout and stderr.**

**Parameters:**
- `command` (required): The command to execute (e.g., 'deno test', 'git status')

**Returns:** Combined stdout and stderr output

**Limitations:**
- Output limited to 5,000 characters (truncated if longer)
- Command timeout: reasonable for most operations
- Exit code shown if non-zero

**Examples:**

```json
// Run tests
{
  "command": "deno test -A"
}

// Check git status
{
  "command": "git status"
}

// Run build
{
  "command": "deno check server/main.ts"
}

// Multiple commands (with &&)
{
  "command": "deno fmt && deno check server/main.ts"
}
```

**Common Commands:**
```bash
# Deno
deno task dev          # Start dev server
deno task start        # Start production
deno test -A           # Run tests
deno check server/*.ts # Type check
deno fmt               # Format code

# Git
git status             # Check status
git diff               # Show changes
git log --oneline -10  # Recent commits
git add .              # Stage all
git commit -m "msg"    # Commit

# System
ls -la                 # List files (use list_directory instead)
cat file.txt           # Read file (use read_file instead)
grep pattern *.ts      # Search (use search_files instead)
```

**Use When:**
- Running tests
- Building/checking code
- Git operations
- Installing dependencies
- Running scripts

**Avoid When:**
- Reading files (use `read_file`)
- Listing directories (use `list_directory`)
- Searching files (use `search_files`)

**Errors:**
- If command exits non-zero: "Command exited with code {n}: {output}"

---

### search_files

Search for a pattern in files using grep. **Returns matching lines with file paths.**

**Parameters:**
- `pattern` (required): Pattern to search for (regex supported)
- `path` (optional): Path to search in. Defaults to '.' (current directory)

**Returns:** Matching lines in format: `filename:line_number:line_content`

**Limitations:**
- Maximum 100 matching lines shown
- OR maximum 5,000 characters total
- Truncated if either limit exceeded

**Examples:**

```json
// Search for function definition
{
  "pattern": "function executeTool"
}

// Search in specific directory
{
  "pattern": "ANTHROPIC_API_KEY",
  "path": "server"
}

// Search for imports
{
  "pattern": "import.*from"
}

// Search for TODO comments
{
  "pattern": "TODO:"
}
```

**Regex Patterns:**
```json
// Function declarations
{"pattern": "function\\s+\\w+"}

// Class definitions
{"pattern": "class\\s+\\w+"}

// Exports
{"pattern": "export\\s+(const|function|class)"}

// Error handling
{"pattern": "(try|catch|throw)"}
```

**Use When:**
- Finding where something is used
- Locating function definitions
- Finding TODOs or FIXMEs
- Understanding code patterns
- Checking for security issues

**Output Example:**
```
server/claude.ts:143:  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
server/tools-mcp.ts:28:      required: ["path"],
client/client.js:15:const ws = new WebSocket(WS_URL);
```

---

## System Tools

### reload_server

Reload the server to apply code changes. **Triggers watch mode restart.**

**Parameters:** None

**Returns:** Success message

**How It Works:**
- Uses `Deno.utime()` to touch `server/main.ts`
- Triggers Deno's watch mode reload
- Server restarts automatically (2-3 seconds)
- All clients reconnect automatically

**Examples:**

```json
// Reload after modifying server code
{}
```

**Use When:**
- After modifying server code (tools, handlers, etc.)
- Want to apply changes immediately
- Testing if watch mode is working

**Note:** The server already runs in watch mode (`deno task dev`) and auto-reloads when files change. This tool just triggers an immediate reload.

---

## Best Practices

### File Editing Strategy

**Decision Tree:**

1. **Creating new file?** → Use `create_file`
2. **Single-line change with known exact string?** → Use `edit_file`
3. **Multi-line change or unsure of exact string?** → Use `edit_file_range`
4. **Large file?** → Use `read_file_range` first, then `edit_file_range`

### Reading Files Efficiently

```
Small file (<1000 lines):
  read_file → get all content

Large file or specific section:
  read_file_range(1, 50) → see structure
  read_file_range(100, 200) → read specific function

Finding something:
  search_files("pattern") → locate
  read_file_range(found_line - 10, found_line + 10) → context
```

### Command Execution

```
✅ Good:
  execute_command("deno test")
  execute_command("git status")

❌ Avoid (use dedicated tools):
  execute_command("cat file.txt")     → use read_file
  execute_command("ls")               → use list_directory
  execute_command("grep pattern *")   → use search_files
```

### Progressive Exploration

```
1. list_directory(".")              → see root
2. list_directory("server")         → see server files
3. read_file_range("server/main.ts", 1, 30) → scan file
4. search_files("WebSocket", "server")      → find usage
5. read_file_range("server/main.ts", 150, 200) → read specific section
```

---

## Limitations

### File Size Limits

| Tool | Limit | Behavior When Exceeded |
|------|-------|------------------------|
| `read_file` | 10,000 chars | Truncated with message |
| `execute_command` output | 5,000 chars | Truncated with message |
| `search_files` output | 100 lines OR 5,000 chars | Truncated with message |
| `list_directory` | 500 entries | Truncated with message |

### Path Restrictions

- All paths must be relative to project root
- Path traversal (../) is detected and blocked
- Paths are sanitized with `join(BASE_DIR, path)`
- If path tries to escape project: "Path traversal detected"

### Performance Considerations

- Large file operations may take longer
- Command execution timeout exists (reasonable for most ops)
- Truncation prevents context explosion
- Watch mode reload takes 2-3 seconds

---

## Error Handling

### Common Errors and Solutions

**File Not Found**
```
Error: "File {path} not found"
Solution: Check path spelling, use list_directory to verify
```

**File Already Exists**
```
Error: "File {path} already exists"
Solution: Use edit_file_range or edit_file to modify
```

**String Not Found (edit_file)**
```
Error: "String not found in {path}"
Solution: Use read_file to check exact content, or use edit_file_range instead
```

**Line Out of Range**
```
Error: "start_line {n} exceeds file length"
Solution: Use read_file or read_file_range to check file size
```

**Command Failed**
```
Error: "Command exited with code {n}"
Solution: Check command syntax, read error output
```

**Path Traversal**
```
Error: "Path traversal detected"
Solution: Use paths relative to project root, no ../
```

### Recovery Strategies

**If edit_file fails:**
1. Use `read_file_range` to see current content
2. Verify exact string (including whitespace)
3. Switch to `edit_file_range` for more reliability

**If command fails:**
1. Read error message carefully
2. Check command syntax
3. Try simpler version of command
4. Use dedicated tools instead (read_file vs cat)

**If file operations fail:**
1. Use `list_directory` to check file exists
2. Check path spelling
3. Ensure using relative paths
4. Verify parent directory exists (auto-created for create_file)

---

## Tool Selection Quick Reference

| Task | Tool | Example |
|------|------|---------|
| Read small file | `read_file` | `{"path": "server/main.ts"}` |
| Read specific lines | `read_file_range` | `{"path": "server/main.ts", "start_line": 1, "end_line": 20}` |
| Create new file | `create_file` | `{"path": "new.ts", "content": "..."}` |
| Single-line edit | `edit_file` | `{"path": "config.ts", "old_string": "...", "new_string": "..."}` |
| Multi-line edit | `edit_file_range` | `{"path": "server/main.ts", "start_line": 10, "end_line": 15, "new_content": "..."}` |
| List directory | `list_directory` | `{"path": "server"}` |
| Run command | `execute_command` | `{"command": "deno test"}` |
| Search code | `search_files` | `{"pattern": "function.*executeTool"}` |
| Reload server | `reload_server` | `{}` |

---

## Examples by Use Case

### Adding a New Feature

```json
// 1. Explore structure
{"tool": "list_directory", "path": "server"}

// 2. Read related file
{"tool": "read_file", "path": "server/tools-mcp.ts"}

// 3. Create new file
{"tool": "create_file", "path": "server/new-feature.ts", "content": "..."}

// 4. Update imports
{"tool": "read_file_range", "path": "server/main.ts", "start_line": 1, "end_line": 10}
{"tool": "edit_file_range", "path": "server/main.ts", "start_line": 5, "end_line": 5, "new_content": "import { newFeature } from './new-feature.ts';"}

// 5. Test
{"tool": "execute_command", "command": "deno check server/main.ts"}

// 6. Reload
{"tool": "reload_server"}
```

### Fixing a Bug

```json
// 1. Find the bug location
{"tool": "search_files", "pattern": "buggy.*function"}

// 2. Read context around bug
{"tool": "read_file_range", "path": "server/buggy.ts", "start_line": 40, "end_line": 60}

// 3. Fix the bug
{"tool": "edit_file_range", "path": "server/buggy.ts", "start_line": 45, "end_line": 48, "new_content": "fixed code here"}

// 4. Test the fix
{"tool": "execute_command", "command": "deno test"}

// 5. Check git diff
{"tool": "execute_command", "command": "git diff"}
```

### Refactoring Code

```json
// 1. Search for all uses
{"tool": "search_files", "pattern": "oldFunctionName"}

// 2. Read each file
{"tool": "read_file", "path": "server/file1.ts"}

// 3. Update each occurrence
{"tool": "edit_file_range", "path": "server/file1.ts", "start_line": 10, "end_line": 12, "new_content": "newFunctionName()"}

// 4. Verify with type check
{"tool": "execute_command", "command": "deno check server/*.ts"}

// 5. Run tests
{"tool": "execute_command", "command": "deno test -A"}
```

---

## See Also

- [README.md](README.md) - Project overview and quick start
- [CLAUDE.md](CLAUDE.md) - Instructions for external Claude Code
- [MOBILE.md](MOBILE.md) - PWA and mobile setup
- [scripts/README.md](scripts/README.md) - Development scripts
