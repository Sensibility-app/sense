# Sense Documentation Analysis

This document analyzes all documentation, instructions, and context provided to the Claude assistant when working with Sense.

## Current Documentation Files

### 1. README.md (User-facing)
**Purpose:** Quick start guide for users
**Content:**
- Setup instructions (API key, start server)
- How it works (architecture diagram)
- Available tools list
- Example tasks
- Architecture benefits
- Development commands
- Project structure
- Self-hosting examples

**Target Audience:** New users, developers trying the project
**Status:** ✅ Good, concise, practical

---

### 2. CLAUDE.md (Assistant Instructions)
**Purpose:** Instructions for Claude Code when working with this repository
**Content:**
- Project overview and architecture
- How the tool system works
- Available tools
- Repository structure
- Development commands
- Key principles
- Deno-specific guidance
- Development philosophy
- Current status

**Target Audience:** Claude Code assistant (via CLAUDE.md convention)
**Status:** ✅ Comprehensive, well-structured
**Note:** This file is read by Claude Code but NOT by the embedded Claude in Sense

---

### 3. MOBILE.md
**Purpose:** PWA/mobile setup documentation
**Content:**
- Mobile features
- Installation instructions (iOS/Android)
- Icon generation
- Mobile optimizations
- Technical details
- Troubleshooting

**Target Audience:** Users wanting mobile access
**Status:** ✅ Detailed and helpful

---

### 4. agent-first-self-hosting-plan.md
**Purpose:** Original design document and bootstrap plan
**Content:**
- Core principles
- Phase-by-phase development plan
- Agent action protocol (now obsolete - we use Anthropic's native tool use)
- Tool set design
- Success criteria

**Target Audience:** Developers understanding the project's evolution
**Status:** ⚠️ Historical document, some content is outdated (mentions custom JSON protocol we don't use)

---

### 5. scripts/README.md
**Purpose:** Documentation for development scripts
**Content:**
- ws-test.ts usage guide
- Options and examples
- Features and output format
- Use cases

**Target Audience:** Developers testing the system
**Status:** ✅ Clear and practical

---

### 6. hello.md
**Content:** "Andrei has been here!"
**Status:** ❌ Not useful, can be deleted

---

## System Prompt (In server/claude.ts)

### What Claude Knows About Itself

The embedded Claude assistant receives this system prompt:

```
You are Claude Code, an AI assistant integrated into a browser-based
development environment called Sense.

You have access to tools that allow you to interact with the filesystem
and execute commands.
```

### Project Context Given

1. **Runtime:** Deno project (not Node.js)
2. **Working directory:** Dynamic (Deno.cwd())
3. **File paths:** Relative to project root
4. **Capabilities:** Read, write, list, execute, search

### Best Practices Embedded

- **File editing:** Prefer `edit_file_range` for multi-line, `edit_file` for single-line
- **File creation:** Use `create_file` only for new files
- **Reading:** Use `read_file_range` for large files

### Project Structure Taught

```
/server  - TypeScript for Deno
/client  - HTML/CSS/JS for browser
/.sense/sessions - Session logs
```

### Self-Hosting Knowledge

- Server auto-reloads in watch mode
- Can use `reload_server` tool for immediate reload
- Can modify own tools, handlers, and system prompts
- Client changes need browser refresh

### Exploration Strategy

- Progressive directory drilling (root → subdirs)
- Never repeat same tool call with same arguments
- Use `search_files` or `read_file` to examine specific files

---

## Available Tools (server/tools-mcp.ts)

### File System Tools

1. **read_file**
   - Read complete file contents
   - Returns string
   - Required: `path`

2. **create_file**
   - Create NEW file only (fails if exists)
   - Auto-creates parent directories
   - Required: `path`, `content`

3. **edit_file**
   - Replace exact string matches
   - For small, precise edits
   - Requires exact whitespace match
   - Required: `path`, `old_string`, `new_string`

4. **read_file_range**
   - Read specific line range (1-indexed)
   - More efficient for large files
   - Use -1 for end of file
   - Required: `path`, `start_line`, `end_line`

5. **edit_file_range** ⭐ RECOMMENDED
   - Replace line range with new content
   - Most reliable (works after auto-formatting)
   - Use for multi-line changes
   - Required: `path`, `start_line`, `end_line`, `new_content`

### Directory Tools

6. **list_directory**
   - List files and directories
   - Directories marked with trailing /
   - Optional: `path` (defaults to '.')
   - Sorted: directories first, then files

### Execution Tools

7. **execute_command**
   - Run shell commands (git, deno, tests, etc.)
   - Returns stdout/stderr
   - Output limited to 5000 chars
   - Required: `command`

8. **search_files**
   - Search with grep
   - Returns matching lines with file paths
   - Limited to 100 lines or 5000 chars
   - Required: `pattern`
   - Optional: `path` (defaults to '.')

### System Tools

9. **reload_server**
   - Trigger server reload
   - Uses `Deno.utime()` to touch main.ts
   - Triggers watch mode restart
   - No parameters

---

## Documentation Gaps & Issues

### 🔴 Critical Gaps

1. **No unified "How Tools Work" guide**
   - Tool descriptions are scattered across:
     - System prompt
     - Tool definitions
     - README.md (partial list)
     - CLAUDE.md (another list)
   - Need single source of truth

2. **CLAUDE.md not accessible to embedded Claude**
   - CLAUDE.md is read by Claude Code (external)
   - Embedded Claude in Sense ONLY sees system prompt
   - Duplication of information

3. **No self-documentation mechanism**
   - Claude can't easily query "what tools do I have?"
   - No introspection tool
   - Could add `list_tools` or `help` tool

### ⚠️ Medium Issues

4. **Outdated agent-first-self-hosting-plan.md**
   - Describes custom JSON protocol we abandoned
   - Should be marked as historical or updated

5. **No troubleshooting guide**
   - What if tools fail?
   - What if session gets too large?
   - How to recover from errors?

6. **No architecture documentation**
   - How does streaming work?
   - How is session state managed?
   - How does loop detection work?

7. **Tool limitations not documented**
   - File size limits (10K chars for read_file)
   - Command output limits (5000 chars)
   - Directory listing limits (500 entries)
   - Search limits (100 lines)

### 💡 Minor Improvements

8. ~~**hello.md serves no purpose**~~
   - **PROTECTED FILE: Must never be deleted or modified**

9. **No CONTRIBUTING.md**
   - How should others contribute?
   - Code style?
   - Testing approach?

10. **No CHANGELOG.md**
    - Track major changes
    - Version history
    - Breaking changes

---

## Recommendations for Self-Sufficiency

### High Priority

1. **Create TOOLS.md** - Comprehensive tool reference
   - All tools in one place
   - Examples for each tool
   - Limitations and edge cases
   - Best practices

2. **Add `help` or `get_documentation` tool**
   - Claude can query documentation on demand
   - Returns tool usage, best practices, etc.
   - Makes system truly self-documenting

3. **Consolidate duplicated content**
   - CLAUDE.md → primarily for external Claude Code
   - System prompt → core instructions only
   - New TOOLS.md → complete tool reference
   - README.md → user-facing overview

### Medium Priority

4. **Create ARCHITECTURE.md**
   - How streaming works
   - Session management
   - Loop detection
   - Message flow diagrams

5. **Create TROUBLESHOOTING.md**
   - Common issues and solutions
   - Error recovery
   - Performance tips
   - Session management

6. **Update agent-first-self-hosting-plan.md**
   - Mark as historical
   - Add note about current implementation
   - Keep for reference but clarify it's not current

### Low Priority

7. **Add CONTRIBUTING.md**
8. **Add CHANGELOG.md**
9. ~~**Delete hello.md**~~ **PROTECTED: hello.md must never be deleted or modified**
10. **Add inline code documentation**
    - JSDoc comments
    - Type annotations
    - Function purposes

---

## Proposed New Documentation Structure

```
/docs
  ARCHITECTURE.md     - System design and data flow
  TOOLS.md           - Complete tool reference
  TROUBLESHOOTING.md - Common issues
  DEVELOPMENT.md     - Developer guide

/
  README.md          - Quick start (user-facing)
  CLAUDE.md          - External Claude Code instructions
  MOBILE.md          - PWA/mobile guide
  CONTRIBUTING.md    - Contribution guide
  CHANGELOG.md       - Version history

/scripts
  README.md          - Script documentation

/server
  *.ts              - Add JSDoc comments

/.sense
  /history          - Design decisions log
```

---

## Self-Sufficiency Test

**Can Claude in Sense answer these questions without external help?**

- ✅ What tools are available? (via system prompt)
- ✅ How to edit a file? (via system prompt + tool descriptions)
- ✅ Where is server code? (via system prompt)
- ❌ What are the tool limitations? (not documented)
- ❌ How to troubleshoot errors? (not documented)
- ❌ What's the architecture? (not documented)
- ❌ How to add a new tool? (not documented in accessible place)
- ❌ What's the max file size I can read? (not documented)

**Score: 3/8 (37.5%)** - Room for improvement!

---

## Action Items

### Immediate (for self-sufficiency)

1. ✅ Create this analysis document
2. ⏳ Create TOOLS.md with complete reference
3. ⏳ Add tool limitations to system prompt or TOOLS.md
4. ⏳ Consider adding `help` tool for runtime documentation access

### Short-term

5. ⏳ Create ARCHITECTURE.md
6. ⏳ Create TROUBLESHOOTING.md
7. ⏳ Mark agent-first-self-hosting-plan.md as historical
8. ⏳ Delete hello.md

### Long-term

9. ⏳ Add JSDoc comments to all functions
10. ⏳ Create CONTRIBUTING.md
11. ⏳ Create CHANGELOG.md
12. ⏳ Consolidate docs into /docs directory

---

## Conclusion

Sense has **good foundational documentation** for users and external Claude Code, but the **embedded Claude assistant lacks comprehensive documentation** it can access at runtime.

**Key improvements for self-sufficiency:**
1. Comprehensive tool reference (TOOLS.md)
2. Runtime-accessible help system (help tool)
3. Document limitations and edge cases
4. Architecture and troubleshooting guides

Once these are in place, Sense will be truly self-sufficient - Claude will be able to understand, modify, and improve the system without external documentation.
