// src/env/load-dotenv.ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const index = trimmed.indexOf("=");
  if (index <= 0) return null;
  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  return [key, value];
}
function loadDotEnv(path = resolve(process.cwd(), ".env")) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    process.env[key] ??= value;
  }
}
loadDotEnv();

// src/client/credentials.ts
import { readFileSync as readFileSync2, writeFileSync, unlinkSync, existsSync as existsSync2, chmodSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";
var DEFAULT_DATA_DIR = "run";
var CREDENTIALS_FILE = "zalo-credentials.json";
var LEGACY_CREDENTIALS_PATH = join(homedir(), ".openclaw", "zaloclaw-credentials.json");
function getGatewayDataDir(env = process.env) {
  const configured = env.ZALO_GATEWAY_DATA_DIR?.trim() || DEFAULT_DATA_DIR;
  return isAbsolute(configured) ? configured : join(process.cwd(), configured);
}
function getCredentialsPath(env = process.env) {
  return join(getGatewayDataDir(env), "credentials", CREDENTIALS_FILE);
}
function migrateLegacyCredentialsIfNeeded(path = getCredentialsPath()) {
  if (existsSync2(path) || !existsSync2(LEGACY_CREDENTIALS_PATH)) return;
  const dir = dirname(path);
  if (!existsSync2(dir)) mkdirSync(dir, { recursive: true, mode: 448 });
  copyFileSync(LEGACY_CREDENTIALS_PATH, path);
  try {
    chmodSync(path, 384);
  } catch {
  }
}
function loadCredentials() {
  const path = getCredentialsPath();
  migrateLegacyCredentialsIfNeeded(path);
  if (!existsSync2(path)) {
    return null;
  }
  try {
    const raw = readFileSync2(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function hasCredentials() {
  const path = getCredentialsPath();
  migrateLegacyCredentialsIfNeeded(path);
  return existsSync2(path);
}

// src/client/zalo-client.ts
import { Zalo, LoginQRCallbackEventType } from "zca-js";
import sharp from "sharp";
import * as fs from "fs";
var apiInstance = null;
var currentUid = null;
async function imageMetadataGetter(filePath) {
  const data = await fs.promises.readFile(filePath);
  const metadata = await sharp(data).metadata();
  return {
    height: metadata.height || 0,
    width: metadata.width || 0,
    size: metadata.size || data.length
  };
}
async function loginWithCredentials() {
  const creds = loadCredentials();
  if (!creds) {
    throw new Error("No saved credentials found. Login with QR first.");
  }
  const zalo = new Zalo({ logging: false, imageMetadataGetter });
  const api = await zalo.login({
    imei: creds.imei,
    cookie: creds.cookie,
    userAgent: creds.userAgent,
    language: creds.language
  });
  apiInstance = api;
  try {
    const raw = await api.fetchAccountInfo();
    const info = raw?.profile ?? raw;
    currentUid = info?.userId ?? null;
  } catch {
  }
  return api;
}
function getCurrentUid() {
  return currentUid;
}
function isAuthenticated() {
  return apiInstance !== null;
}
function hasStoredCredentials() {
  return hasCredentials();
}

// src/cli/zalo-status.ts
async function main() {
  const status = {
    hasStoredCredentials: hasStoredCredentials(),
    authenticated: isAuthenticated(),
    currentUid: getCurrentUid(),
    dataDir: getGatewayDataDir(),
    credentialsPath: getCredentialsPath()
  };
  if (!status.hasStoredCredentials) {
    console.log(JSON.stringify({ ...status, status: "missing_credentials" }, null, 2));
    process.exitCode = 1;
    return;
  }
  try {
    const api = await loginWithCredentials();
    const account = await api.fetchAccountInfo().catch(() => void 0);
    console.log(JSON.stringify({
      hasStoredCredentials: true,
      authenticated: true,
      currentUid: getCurrentUid(),
      dataDir: getGatewayDataDir(),
      credentialsPath: getCredentialsPath(),
      status: "connected",
      account
    }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({
      ...status,
      status: "invalid_credentials",
      error: err instanceof Error ? err.message : String(err)
    }, null, 2));
    process.exitCode = 1;
  }
}
main().catch((err) => {
  console.error(`[zalo-api-gateway] Status check failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
