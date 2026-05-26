import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SSHConnectionManager } from "../services/ssh-connection-manager.js";
import { SessionManager } from "../services/session-manager.js";

type ServerInfo = ReturnType<SSHConnectionManager["getAllServerInfos"]>[number];

export function formatServerList(servers: ServerInfo[]): string {
  if (servers.length === 0) {
    return "No SSH servers configured.";
  }

  const summary = servers.map((server) => {
    const parts = [
      `[${server.connected ? "connected" : "disconnected"}] ${server.name}`,
      `${server.username}@${server.host}:${server.port}`,
    ];

    if (server.status?.hostname) {
      parts.push(`hostname=${server.status.hostname}`);
    }

    if (server.status?.osName) {
      parts.push(`os=${server.status.osName}`);
    }

    if (server.status?.lastUpdated) {
      parts.push(`updated=${server.status.lastUpdated}`);
    }

    return parts.join(" | ");
  });

  return [
    "Configured SSH servers:",
    ...summary,
    "",
    "Raw JSON:",
    JSON.stringify(servers, null, 2),
  ].join("\n");
}

/**
 * Register list-servers tool
 */
export function registerListServersTool(server: McpServer): void {
  server.registerTool(
    "list-servers",
    {
      description: "List all available SSH server configurations",
      inputSchema: {
        sessid: z
          .string()
          .optional()
          .describe("Optional session ID returned by create-session. If omitted, all sessions are listed."),
      },
    },
    async ({ sessid }) => {
      const sshManager = SSHConnectionManager.getInstance();
      const sessionManager = SessionManager.getInstance();
      const servers = sessid
        ? sshManager
            .getAllServerInfos()
            .filter((serverInfo) => serverInfo.name === sessionManager.requireSession(sessid))
        : sshManager.getAllServerInfos();
      return {
        content: [
          {
            type: "text",
            text: formatServerList(servers),
          },
        ],
      };
    },
  );
}
