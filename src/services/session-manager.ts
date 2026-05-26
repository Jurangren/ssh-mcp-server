import { randomUUID } from "node:crypto";
import { SSHConfig, SshConnectionConfigMap } from "../models/types.js";
import { SSHConnectionManager } from "./ssh-connection-manager.js";
import { Logger } from "../utils/logger.js";

const DEFAULT_SESSION_TTL_MS = 5 * 60 * 1000;

type SessionRecord = {
  config: SSHConfig;
  ttlMs: number;
  timeoutId?: NodeJS.Timeout;
};

export class SessionManager {
  private static instance: SessionManager;
  private sessionConfigs: Map<string, SessionRecord> = new Map();

  private constructor() {}

  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  public createSession(config: SSHConfig, ttlMs: number = DEFAULT_SESSION_TTL_MS): string {
    const sessid = randomUUID();
    const sessionConfig: SSHConfig = {
      ...config,
      name: sessid,
    };
    this.sessionConfigs.set(sessid, {
      config: sessionConfig,
      ttlMs,
    });
    SSHConnectionManager.getInstance().addConfig(sessid, sessionConfig);
    this.touchSession(sessid);
    return sessid;
  }

  public removeSession(sessid: string): void {
    const record = this.sessionConfigs.get(sessid);
    if (record?.timeoutId) {
      clearTimeout(record.timeoutId);
    }
    this.sessionConfigs.delete(sessid);
    SSHConnectionManager.getInstance().removeConfig(sessid);
  }

  public addInitialConfigs(configs: SshConnectionConfigMap): void {
    for (const [name, config] of Object.entries(configs)) {
      this.sessionConfigs.set(name, {
        config: {
          ...config,
          name,
        },
        ttlMs: DEFAULT_SESSION_TTL_MS,
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
    this.touchSession(sessid);
    return sessid;
  }

  public listSessionIds(): string[] {
    return Array.from(this.sessionConfigs.keys());
  }

  public clear(): void {
    for (const record of this.sessionConfigs.values()) {
      if (record.timeoutId) {
        clearTimeout(record.timeoutId);
      }
    }
    this.sessionConfigs.clear();
    this.syncToSshManager();
  }

  public touchSession(sessid: string): void {
    const record = this.sessionConfigs.get(sessid);
    if (!record) {
      return;
    }
    if (record.timeoutId) {
      clearTimeout(record.timeoutId);
    }
    record.timeoutId = setTimeout(() => {
      Logger.log(`Session '${sessid}' idle timeout reached, releasing SSH connection.`, "info");
      this.removeSession(sessid);
    }, record.ttlMs);
  }

  private syncToSshManager(): void {
    const configMap: SshConnectionConfigMap = {};
    for (const [sessid, record] of this.sessionConfigs.entries()) {
      configMap[sessid] = record.config;
    }
    SSHConnectionManager.getInstance().setConfig(configMap);
  }
}
