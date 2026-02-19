export interface ParsedCommand {
  name: string;
  args: Record<string, string>;
}

export function isCommand(input: string): boolean {
  return input.trim().startsWith("/");
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const withoutSlash = trimmed.slice(1);
  const firstSpace = withoutSlash.indexOf(" ");
  
  if (firstSpace === -1) {
    return { name: withoutSlash, args: {} };
  }

  const name = withoutSlash.slice(0, firstSpace);
  const argsString = withoutSlash.slice(firstSpace + 1);
  const args: Record<string, string> = {};

  const matches = argsString.matchAll(/(\w+)=(?:"([^"]*)"|'([^']*)'|(\S+))/g);
  for (const match of matches) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    args[key] = value;
  }

  return { name, args };
}
