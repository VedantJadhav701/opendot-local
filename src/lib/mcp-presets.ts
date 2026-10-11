export type McpPreset = {
  id: string;
  name: string;
  description: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  authType: "none" | "token" | "basic";
  authHelp?: string;
  authUrl?: string;
  defaultHeaders?: Record<string, string>;
  defaultEnv?: Record<string, string>;
  keywords: string[];
};

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Search repos, read files, manage issues and pull requests via GitHub MCP server.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    authType: "token",
    authHelp: "Create a Personal Access Token with repo scopes and supply GITHUB_PERSONAL_ACCESS_TOKEN in env.",
    authUrl: "https://github.com/settings/tokens",
    keywords: ["github", "issue", "pr", "repo", "commit"],
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Local file tools limited to approved project directories.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    authType: "none",
    keywords: ["filesystem", "files", "folder"],
  },
  {
    id: "mail",
    name: "Mail (Local IMAP)",
    description: "Read and search email from your own mail server without a third-party cloud broker.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-server-imap"],
    authType: "basic",
    authHelp: "Supply your IMAP username and app password in environment variables.",
    keywords: ["mail", "email", "inbox"],
  },
  {
    id: "calendar",
    name: "Calendar (ICS Feed)",
    description: "Read events directly from your private ICS calendar feed.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-server-calendar"],
    authType: "none",
    keywords: ["calendar", "event", "schedule"],
  },
];
