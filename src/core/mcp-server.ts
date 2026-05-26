import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { Server as HttpServer } from "node:http";
import { SSHConnectionManager } from "../services/ssh-connection-manager.js";
import { SessionManager } from "../services/session-manager.js";
import { CommandLineParser } from "../cli/command-line-parser.js";
import { Logger } from "../utils/logger.js";
import { registerAllTools } from "../tools/index.js";
import { SERVER_CONFIG } from "../config/server.js";
import { ParsedArgs } from "../models/types.js";

/**
 * MCP Server class
 */
export class SshMcpServer {
  private server: McpServer;
  private sshManager: SSHConnectionManager;
  private sessionManager: SessionManager;
  private httpServer?: HttpServer;
  private shutdownHandlersRegistered = false;
  private shutdownPromise?: Promise<void>;

  constructor() {
    this.server = new McpServer(SERVER_CONFIG);

    this.sshManager = SSHConnectionManager.getInstance();
    this.sessionManager = SessionManager.getInstance();
  }

  /**
   * Register tools
   */
  private registerTools(): void {
    registerAllTools(this.server);
  }

  private async shutdown(reason: string, exitCode?: number): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = (async () => {
        Logger.log(`Received ${reason}, shutting down SSH MCP server...`, "info");

        this.sshManager.disconnect();
        this.sessionManager.clear();

        if (this.httpServer) {
          await new Promise<void>((resolve) => {
            this.httpServer?.close(() => resolve());
          });
          this.httpServer = undefined;
        }

        try {
          await this.server.close();
        } catch (error) {
          Logger.log(
            `Failed to close MCP server cleanly: ${(error as Error).message}`,
            "error",
          );
        }
      })();
    }

    await this.shutdownPromise;

    if (exitCode !== undefined) {
      process.exit(exitCode);
    }
  }

  private registerShutdownHandlers(): void {
    if (this.shutdownHandlersRegistered) {
      return;
    }

    const handleSignal = (signal: NodeJS.Signals) => {
      void this.shutdown(signal, 0);
    };

    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);
    process.stdin.resume();
    process.stdin.once("end", () => void this.shutdown("stdin end", 0));
    process.stdin.once("close", () => void this.shutdown("stdin close", 0));

    this.shutdownHandlersRegistered = true;
  }

  /**
   * Run the server
   */
  public async run(): Promise<void> {
    const parsedArgs = await this.initialize();

    if (parsedArgs.mcpTransport === "http") {
      await this.runHttp(parsedArgs);
      return;
    }

    await this.runStdio();
  }

  private async initialize(): Promise<ParsedArgs> {
    // Initialize SSH configuration
    const parsedArgs = CommandLineParser.parseArgs();
    this.sessionManager.addInitialConfigs(parsedArgs.configs);
    this.registerShutdownHandlers();

    // Security warning
    const allConfigs = Object.values(parsedArgs.configs);
    if (
      allConfigs.some(
        (c) => !c.commandWhitelist || c.commandWhitelist.length === 0
      )
    ) {
      Logger.log(
        "WARNING: Running without a command whitelist is strongly discouraged. Please configure a whitelist to restrict the commands that can be executed.",
        "info"
      );
    }
    if (
      allConfigs.some(
        (c) =>
          (c.transportMode || "exec") === "exec" &&
          (!c.allowedRemotePaths || c.allowedRemotePaths.length === 0)
      )
    ) {
      Logger.log(
        "WARNING: Running without allowedRemotePaths is strongly discouraged. SFTP upload/download can read or write any path on the remote server. Configure allowedRemotePaths to restrict the SFTP surface.",
        "info"
      );
    }

    // Pre-connect to all servers if flag is set
    if (parsedArgs.preConnect) {
      Logger.log("Pre-connecting to all configured SSH servers...", "info");
      try {
        await this.sshManager.connectAll();
        Logger.log("Successfully pre-connected to all SSH servers", "info");
      } catch (error) {
        Logger.log(
          `Warning: Some SSH connections failed during pre-connect: ${(error as Error).message}`,
          "error"
        );
      }
    }

    if (parsedArgs.mcpTransport !== "http") {
      // Register tools on the single stdio server instance.
      this.registerTools();
    }

    return parsedArgs;
  }

  private createServer(): McpServer {
    const server = new McpServer(SERVER_CONFIG);
    registerAllTools(server);
    return server;
  }

  private async runStdio(): Promise<void> {
    // Create transport instance and connect
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    Logger.log("MCP server connection established");
  }

  private async runHttp(parsedArgs: ParsedArgs): Promise<void> {
    const transports: Record<string, StreamableHTTPServerTransport> = {};
    const servers: Record<string, McpServer> = {};
    const app = createMcpExpressApp({ host: parsedArgs.http.host });

    const authenticate = (req: { headers: Record<string, unknown> }): boolean => {
      if (!parsedArgs.http.apiKey) {
        return true;
      }
      const authHeader = req.headers.authorization;
      return authHeader === `Bearer ${parsedArgs.http.apiKey}`;
    };

    app.post(parsedArgs.http.path, async (req, res) => {
      if (!authenticate(req)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined = sessionId
        ? transports[sessionId]
        : undefined;

      try {
        if (!transport && isInitializeRequest(req.body)) {
          const server = this.createServer();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              if (transport) {
                transports[newSessionId] = transport;
                servers[newSessionId] = server;
              }
            },
          });
          transport.onclose = () => {
            if (transport?.sessionId) {
              delete transports[transport.sessionId];
              const serverToClose = servers[transport.sessionId];
              delete servers[transport.sessionId];
              void serverToClose?.close();
            }
          };
          await server.connect(transport);
        }

        if (!transport) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Bad Request: No valid MCP session ID provided",
            },
            id: null,
          });
          return;
        }

        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        Logger.handleError(error, "Failed to handle HTTP MCP request");
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });

    app.get(parsedArgs.http.path, async (req, res) => {
      if (!authenticate(req)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? transports[sessionId] : undefined;
      if (!transport) {
        res.status(400).send("Invalid or missing MCP session ID");
        return;
      }
      await transport.handleRequest(req, res);
    });

    app.delete(parsedArgs.http.path, async (req, res) => {
      if (!authenticate(req)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? transports[sessionId] : undefined;
      if (!transport) {
        res.status(400).send("Invalid or missing MCP session ID");
        return;
      }
      await transport.handleRequest(req, res);
    });

    this.httpServer = app.listen(parsedArgs.http.port, parsedArgs.http.host, () => {
      Logger.log(
        `MCP HTTP server listening on http://${parsedArgs.http.host}:${parsedArgs.http.port}${parsedArgs.http.path}`,
        "info",
      );
    });
  }
}
