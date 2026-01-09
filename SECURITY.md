# Security

This document outlines the security model, limitations, and best practices for Sense.

## Security Model

### Single-User Design

**IMPORTANT**: Sense is designed as a **single-user, local development tool**. The architecture assumes:

- One user accessing the server at a time
- Server running on localhost or a trusted private network
- No authentication or authorization layer
- Global session shared across all connections

**Do NOT expose Sense to the public internet or untrusted networks.**

---

## API Key Security

### Critical: API Key Rotation Required

If you cloned this repository before the security improvements, **your Anthropic API key may have been exposed** in git history.

**Action Required:**
1. Rotate your Anthropic API key immediately at https://console.anthropic.com/
2. Update your `.env` file with the new key
3. Never commit `.env` files to git repositories

### Best Practices

✅ **DO:**
- Store API keys in `.env` files (which are gitignored)
- Use environment variables for sensitive configuration
- Rotate API keys regularly
- Set spending limits in the Anthropic console

❌ **DON'T:**
- Commit `.env` files to git
- Share API keys in code, documentation, or screenshots
- Use production API keys for development
- Expose the server to public networks

---

## Command Execution Security

### Whitelist Protection

The `execute_command` tool uses a **whitelist** of allowed commands to prevent arbitrary code execution:

**Allowed Commands:**
```
git, deno, npm, node
ls, cat, grep, find
echo, pwd, which, whoami
curl, wget, jq
python, python3, ruby, go, cargo, rustc
```

**Security Features:**
- Commands not in the whitelist are rejected
- Proper argument parsing handles quoted strings and escapes
- Command execution is sandboxed to the project directory

**Limitations:**
- Claude can still execute destructive operations with allowed commands (e.g., `git reset --hard`)
- File operations (`rm`, `mv`, etc.) are not whitelisted but can be done through other tools
- Shell operators (`|`, `&&`, `;`) are not supported

---

## File System Access

### Path Traversal Protection

All file operations validate paths to prevent access outside the project directory:

```typescript
function sanitizePath(path: string): string {
  const resolved = join(BASE_DIR, path);
  if (!resolved.startsWith(BASE_DIR)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}
```

### File Size Limits

To prevent context explosion and memory issues:

- **File reads**: 10,000 characters maximum
- **Directory listings**: 500 entries maximum
- **Command output**: 5,000 characters maximum
- **Search results**: 100 results / 5,000 characters maximum

---

## Network Security

### Recommended Deployment

**Development (Default):**
```bash
# Server binds to all interfaces but should only be accessed locally
deno task dev  # http://localhost:8080
```

**Production (Not Recommended):**

Sense is not designed for production deployment. If you must deploy:

1. **Use a reverse proxy** (nginx, Caddy) with:
   - TLS/SSL termination
   - Authentication (basic auth, OAuth, etc.)
   - Rate limiting
   - IP whitelist

2. **Environment hardening:**
   - Run as non-root user
   - Use firewall rules to restrict access
   - Set up monitoring and alerts
   - Implement request logging

3. **Consider alternatives:**
   - Use Anthropic's API directly from your IDE
   - Deploy Claude with proper authentication

---

## Session Data

### Data Storage

Session data is stored in `.sense/` directory:
- `current-session.json` - Active conversation history
- `sessions/` - Task execution logs
- `archives/` - Archived sessions

**Security Considerations:**
- All conversation history is stored in plaintext
- API responses (including tool outputs) are logged
- Sensitive data may be captured in session files
- No encryption at rest

**Best Practices:**
- Regularly clear old sessions
- Don't share session files (may contain API keys or secrets)
- Add `.sense/` to `.gitignore` (already done)

---

## Known Limitations

### No Authentication

- Anyone with network access can use the server
- No user isolation or access control
- All connections share the same Claude session

### No Rate Limiting

- No built-in protection against API abuse
- Cost control must be managed at the Anthropic console level
- No per-user or per-session limits

### Tool Execution Risks

Claude can:
- Read any file in the project directory
- Execute whitelisted commands with any arguments
- Modify files (create, edit, delete)
- Make network requests (via curl, wget)
- Install packages (npm, pip, cargo, etc.)

**Mitigation:**
- Only use Sense in projects you trust
- Review Claude's actions before approving destructive operations
- Keep backups and use version control
- Monitor resource usage

### Prompt Injection

Claude's responses are rendered as markdown in the browser. While `marked` library is configured securely, there's always risk of:
- Cross-site scripting (XSS) if markdown rendering is compromised
- Clickjacking or phishing via crafted responses
- UI manipulation through carefully crafted output

---

## Reporting Security Issues

If you discover a security vulnerability in Sense:

1. **Do NOT** open a public issue
2. Email the maintainers directly (see GitHub profile)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

**Response Time:** We aim to respond within 48 hours and patch critical issues within 7 days.

---

## Security Checklist

Before using Sense in a new environment:

- [ ] Verify `.env` is in `.gitignore`
- [ ] Confirm server is only accessible from localhost/trusted network
- [ ] Review command whitelist for your use case
- [ ] Set Anthropic API spending limits
- [ ] Understand that all connections share the same session
- [ ] Regular session cleanup configured
- [ ] Backup important data before allowing file modifications

---

## Updates and Patches

Security improvements are ongoing. To stay updated:

```bash
git pull origin master
deno cache --reload server/main.ts
```

Check the commit log for security-related changes:
```bash
git log --grep="security" --grep="CVE" --grep="vulnerability" -i
```

---

## License and Disclaimer

Sense is provided "as is" without warranty. Users are responsible for:
- Protecting their API keys
- Securing their deployment
- Reviewing and approving Claude's actions
- Compliance with Anthropic's terms of service

See LICENSE file for full details.
