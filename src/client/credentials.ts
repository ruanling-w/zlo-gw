/**
 * Credential storage with security hardening.
 *
 * Credentials are runtime data, not source/config. Store them under a project-local
 * data directory so Docker can mount the directory as a volume.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, chmodSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";

const DEFAULT_DATA_DIR = "run";
const CREDENTIALS_FILE = "zalo-credentials.json";
const LEGACY_CREDENTIALS_PATH = join(homedir(), ".openclaw", "zaloclaw-credentials.json");

export type ZaloClawCredentials = {
  imei: string;
  cookie: unknown;
  userAgent: string;
  language?: string;
};

export function getGatewayDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ZALO_GATEWAY_DATA_DIR?.trim() || DEFAULT_DATA_DIR;
  return isAbsolute(configured) ? configured : join(process.cwd(), configured);
}

export function getCredentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getGatewayDataDir(env), "credentials", CREDENTIALS_FILE);
}

function migrateLegacyCredentialsIfNeeded(path = getCredentialsPath()): void {
  if (existsSync(path) || !existsSync(LEGACY_CREDENTIALS_PATH)) return;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  copyFileSync(LEGACY_CREDENTIALS_PATH, path);
  try { chmodSync(path, 0o600); } catch {
    // Non-critical on platforms without POSIX permissions.
  }
}

/**
 * Save credentials to disk with restrictive file permissions.
 */
export function saveCredentials(data: ZaloClawCredentials): void {
  const path = getCredentialsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(path, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
  try { chmodSync(path, 0o600); } catch {
    // Non-critical — may fail on Windows.
  }
}

export function loadCredentials(): ZaloClawCredentials | null {
  const path = getCredentialsPath();
  migrateLegacyCredentialsIfNeeded(path);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as ZaloClawCredentials;
  } catch {
    return null;
  }
}

export function deleteCredentials(): void {
  const path = getCredentialsPath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function hasCredentials(): boolean {
  const path = getCredentialsPath();
  migrateLegacyCredentialsIfNeeded(path);
  return existsSync(path);
}

export function refreshCredentials(freshCookies: unknown): void {
  const existing = loadCredentials();
  if (!existing) return;
  existing.cookie = freshCookies;
  saveCredentials(existing);
}
