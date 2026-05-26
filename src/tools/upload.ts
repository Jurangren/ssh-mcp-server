import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SSHConnectionManager } from "../services/ssh-connection-manager.js";
import { SessionManager } from "../services/session-manager.js";
import { Logger } from "../utils/logger.js";
import { toToolError } from "../utils/tool-error.js";

/**
 * Register file upload tool
 */
export function registerUploadTool(server: McpServer): void {
  const sshManager = SSHConnectionManager.getInstance();
  const sessionManager = SessionManager.getInstance();

  server.registerTool(
    "upload",
    {
      description: "Upload file to connected server",
      inputSchema: {
        localPath: z.string().describe("Local path"),
        remotePath: z.string().describe("Remote path"),
        sessid: z.string().describe("Session ID returned by create-session"),
      },
    },
    async ({ localPath, remotePath, sessid }) => {
      try {
        const connectionName = sessionManager.requireSession(sessid);
        const result = await sshManager.upload(localPath, remotePath, connectionName);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (error: unknown) {
        const toolError = toToolError(error, "UNKNOWN_ERROR");
        Logger.handleError(toolError, "Failed to upload file");
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
