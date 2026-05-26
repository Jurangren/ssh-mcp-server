import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SSHConnectionManager } from "../services/ssh-connection-manager.js";
import { SessionManager } from "../services/session-manager.js";
import { Logger } from "../utils/logger.js";
import { toToolError } from "../utils/tool-error.js";

/**
 * Register file download tool
 */
export function registerDownloadTool(server: McpServer): void {
  const sshManager = SSHConnectionManager.getInstance();
  const sessionManager = SessionManager.getInstance();

  server.registerTool(
    "download",
    {
      description: "Download file from connected server",
      inputSchema: {
        remotePath: z.string().describe("Remote path"),
        localPath: z.string().describe("Local path"),
        sessid: z.string().describe("Session ID returned by create-session"),
      },
    },
    async ({ remotePath, localPath, sessid }) => {
      try {
        const connectionName = sessionManager.requireSession(sessid);
        const result = await sshManager.download(remotePath, localPath, connectionName);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (error: unknown) {
        const toolError = toToolError(error, "UNKNOWN_ERROR");
        Logger.handleError(toolError, "Failed to download file");
        return {
          content: [{
            type: "text",
            text: JSON.stringify(
              {
                code: toolError.code,
                message: toolError.message,
                retriable: toolError.retriable,
              },
              null,
              2,
            ),
          }],
          isError: true,
        };
      }
    }
  );
} 
