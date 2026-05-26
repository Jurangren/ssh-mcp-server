import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SSHConfig } from "../models/types.js";
import { SSHConnectionManager } from "../services/ssh-connection-manager.js";
import { SessionManager } from "../services/session-manager.js";
import { Logger } from "../utils/logger.js";
import { toToolError } from "../utils/tool-error.js";

const splitCsv = (value?: string): string[] | undefined =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const DEFAULT_SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * Register create-session tool
 */
export function registerCreateSessionTool(server: McpServer): void {
  const sessionManager = SessionManager.getInstance();
  const sshManager = SSHConnectionManager.getInstance();

  server.registerTool(
    "create-session",
    {
      description:
        "Create an SSH session from the same SSH args accepted by stdio mode and return sessid. Use this sessid in all other tools.",
      inputSchema: {
        host: z.string().describe("SSH host, same as --host"),
        port: z.number().int().positive().default(22).describe("SSH port, same as --port"),
        username: z.string().describe("SSH username, same as --username"),
        password: z.string().optional().describe("SSH password, same as --password"),
        privateKey: z.string().optional().describe("Private key path or content, same as --privateKey"),
        passphrase: z.string().optional().describe("Private key passphrase, same as --passphrase"),
        agent: z.string().optional().describe("SSH agent, same as --agent"),
        whitelist: z
          .string()
          .optional()
          .describe("Command whitelist, comma-separated regexes, same as --whitelist"),
        blacklist: z
          .string()
          .optional()
          .describe("Command blacklist, comma-separated regexes, same as --blacklist"),
        socksProxy: z.string().optional().describe("SOCKS proxy URL, same as --socksProxy"),
        allowedLocalPaths: z
          .string()
          .optional()
          .describe("Allowed local paths, comma-separated, same as --allowed-local-paths"),
        allowedRemotePaths: z
          .string()
          .optional()
          .describe("Allowed remote paths, comma-separated, same as --allowed-remote-paths"),
        transportMode: z
          .enum(["exec", "shell"])
          .default("exec")
          .describe("SSH transport mode, same as --transport-mode"),
        shellReadyTimeoutMs: z
          .number()
          .int()
          .positive()
          .default(10000)
          .describe("Shell readiness timeout in milliseconds, same as --shell-ready-timeout"),
        shellCommandTimeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Shell command timeout in milliseconds"),
        sessionTtlMs: z
          .number()
          .int()
          .positive()
          .default(DEFAULT_SESSION_TTL_MS)
          .describe(
            "Idle session timeout in milliseconds. Default is 5 minutes. Values greater than 30 minutes are not recommended.",
          ),
        commandTemplate: z
          .string()
          .optional()
          .describe("Command template, same as --command-template"),
        pty: z.boolean().optional().describe("Allocate pseudo-tty, same as --pty"),
        tryKeyboard: z
          .boolean()
          .optional()
          .describe("Enable keyboard-interactive auth, same as --try-keyboard"),
      },
    },
    async (args) => {
      try {
        if (!args.password && !args.privateKey && !args.agent) {
          throw new Error("Missing authentication: provide password, privateKey, or agent.");
        }

        const config: SSHConfig = {
          host: args.host,
          port: args.port,
          username: args.username,
          password: args.password,
          privateKey: args.privateKey,
          passphrase: args.passphrase,
          agent: args.agent,
          commandWhitelist: splitCsv(args.whitelist),
          commandBlacklist: splitCsv(args.blacklist),
          socksProxy: args.socksProxy,
          allowedLocalPaths: splitCsv(args.allowedLocalPaths),
          allowedRemotePaths: splitCsv(args.allowedRemotePaths),
          transportMode: args.transportMode,
          shellReadyTimeoutMs: args.shellReadyTimeoutMs,
          shellCommandTimeoutMs: args.shellCommandTimeoutMs,
          commandTemplate: args.commandTemplate,
          pty: args.pty,
          tryKeyboard: args.tryKeyboard,
        };

        const sessid = sessionManager.createSession(config, args.sessionTtlMs);

        try {
          await sshManager.connect(sessid);
        } catch (error) {
          sessionManager.removeSession(sessid);
          throw error;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ sessid }, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        const toolError = toToolError(error, "SESSION_CREATE_FAILED");
        Logger.handleError(toolError, "Failed to create SSH session");
        return {
          content: [
            {
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
            },
          ],
          isError: true,
        };
      }
    },
  );
}
