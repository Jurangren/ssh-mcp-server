import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SSHConnectionManager } from "../services/ssh-connection-manager.js";
import { SessionManager } from "../services/session-manager.js";
import { Logger } from "../utils/logger.js";
import { toToolError } from "../utils/tool-error.js";

/**
 * Register execute command tool
 */
export function registerExecuteCommandTool(server: McpServer): void {
  const sshManager = SSHConnectionManager.getInstance();
  const sessionManager = SessionManager.getInstance();

  server.registerTool(
    "execute-command",
    {
      description: "Execute command on connected server and get output result",
      inputSchema: {
        cmdString: z.string().describe("Command to execute"),
        sessid: z.string().describe("Session ID returned by create-session"),
        directory: z.string().optional().describe("Working directory for command execution"),
        timeout: z
          .number()
          .optional()
          .describe(
            "Command execution timeout in milliseconds (optional, default is 30000ms)",
          ),
      },
    },
    async ({ cmdString, sessid, directory, timeout }) => {
      try {
        const connectionName = sessionManager.requireSession(sessid);
        const result = await sshManager.executeCommand(
          cmdString,
          directory,
          connectionName,
          {
            timeout,
          },
        );
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (error: unknown) {
        const toolError = toToolError(error, "UNKNOWN_ERROR");
        Logger.handleError(toolError, "Failed to execute command");
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
    },
  );
}
