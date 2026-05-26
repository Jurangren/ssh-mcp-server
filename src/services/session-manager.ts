import { randomUUID } from "node:crypto";
import { SSHConfig, SshConnectionConfigMap } from "../models/types.js";
import { SSHConnectionManager } from "./ssh-connection-manager.js";

export class SessionManager {
  private static instance: SessionManager;
  private sessionConfigs: Map<string, SSHConfig> = new Map();

  private constructor() {}

  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  public createSession(config: SSHConfig): string {
    const sessid = randomUUID();
    const sessionConfig: SSHConfig = {
      ...config,
      name: sessid,
    };
    this.sessionConfigs.set(sessid, sessionConfig);
    this.syncToSshManager();
    return sessid;
  }

  public addInitialConfigs(configs: SshConnectionConfigMap): void {
    for (const [name, config] of Object.entries(configs)) {
      this.sessionConfigs.set(name, {
        ...config,
        name,
      });
    }
    this.syncToSshManager();
  }

  public requireSession(sessid: string): string {
    if (!this.sessionConfigs.has(sessid)) {
      throw new Error(
        `Session '${sessid}' not found. Call create-session first and pass the returned sessid.`,
      );
    }
    return sessid;
  }

  public listSessionIds(): string[] {
    return Array.from(this.sessionConfigs.keys());
  }

  public clear(): void {
    this.sessionConfigs.clear();
    this.syncToSshManager();
  }

  private syncToSshManager(): void {
    const configMap: SshConnectionConfigMap = {};
    for (const [sessid, config] of this.sessionConfigs.entries()) {
      configMap[sessid] = config;
    }
    SSHConnectionManager.getInstance().setConfig(configMap);
  }
}
