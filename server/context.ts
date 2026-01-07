import { join } from "jsr:@std/path@^1.0.0";

export interface ProjectContext {
  cwd: string;
  fileTree: string;
  recentChanges?: string;
  readme?: string;
}

// Build file tree recursively
async function buildFileTree(dir: string, prefix = "", maxDepth = 3, currentDepth = 0): Promise<string> {
  if (currentDepth >= maxDepth) return "";

  const entries: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      // Skip hidden files and directories, node_modules, etc
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "deno.lock") {
        continue;
      }

      const isLast = false; // Would need to track this properly
      const marker = isLast ? "└── " : "├── ";
      const line = `${prefix}${marker}${entry.name}`;
      entries.push(line);

      if (entry.isDirectory) {
        const subDir = join(dir, entry.name);
        const subPrefix = prefix + (isLast ? "    " : "│   ");
        const subTree = await buildFileTree(subDir, subPrefix, maxDepth, currentDepth + 1);
        if (subTree) entries.push(subTree);
      }
    }
  } catch {
    // Ignore errors for inaccessible directories
  }

  return entries.join("\n");
}

// Get git status and recent changes
async function getGitInfo(): Promise<string> {
  try {
    const status = new Deno.Command("git", {
      args: ["status", "--short"],
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await status.output();
    const statusText = new TextDecoder().decode(stdout).trim();

    if (!statusText) return "Working tree clean";
    return `Modified files:\n${statusText}`;
  } catch {
    return "Not a git repository";
  }
}

// Read README if it exists
async function getReadme(): Promise<string | undefined> {
  const readmePaths = ["README.md", "CLAUDE.md"];
  for (const path of readmePaths) {
    try {
      const content = await Deno.readTextFile(path);
      return `${path}:\n${content.slice(0, 1000)}${content.length > 1000 ? "\n..." : ""}`;
    } catch {
      // File doesn't exist, try next
    }
  }
  return undefined;
}

export async function buildProjectContext(): Promise<ProjectContext> {
  const cwd = Deno.cwd();
  const fileTree = await buildFileTree(cwd);
  const recentChanges = await getGitInfo();
  const readme = await getReadme();

  return {
    cwd,
    fileTree,
    recentChanges,
    readme,
  };
}

export function formatContextForAgent(context: ProjectContext): string {
  let formatted = `PROJECT CONTEXT\n`;
  formatted += `Working Directory: ${context.cwd}\n\n`;

  formatted += `FILE STRUCTURE:\n${context.fileTree}\n\n`;

  if (context.recentChanges) {
    formatted += `GIT STATUS:\n${context.recentChanges}\n\n`;
  }

  if (context.readme) {
    formatted += `DOCUMENTATION:\n${context.readme}\n\n`;
  }

  formatted += `IMPORTANT: This is a Deno project. Use Deno APIs (Deno.readTextFile, etc), not Node.js APIs.\n`;

  return formatted;
}
