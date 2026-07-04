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
function loadDotEnv(path2 = resolve(process.cwd(), ".env")) {
  if (!existsSync(path2)) return;
  const raw = readFileSync(path2, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    process.env[key] ??= value;
  }
}
loadDotEnv();

// src/cli/zalo-login.ts
import { LoginQRCallbackEventType as LoginQRCallbackEventType2 } from "zca-js";

// src/client/qr-display.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import qrcode from "qrcode-terminal";
import { PNG } from "pngjs";
import jsQR from "jsqr";
async function readQRFromPNG(pngPath) {
  return new Promise((resolve2, reject) => {
    try {
      const buffer = fs.readFileSync(pngPath);
      const png = PNG.sync.read(buffer);
      const code = jsQR(Uint8ClampedArray.from(png.data), png.width, png.height);
      if (!code) {
        reject(new Error("Could not decode QR code from image"));
        return;
      }
      resolve2(code.data);
    } catch (err) {
      reject(new Error(`Failed to read QR code: ${err instanceof Error ? err.message : String(err)}`));
    }
  });
}
async function displayQRFromPNG(base64Image) {
  const uniqueId = crypto.randomBytes(8).toString("hex");
  const pngPath = path.join(os.tmpdir(), `zaloclaw-qr-${uniqueId}.png`);
  try {
    const buffer = Buffer.from(base64Image, "base64");
    fs.writeFileSync(pngPath, buffer, { mode: 384 });
    const qrContent = await readQRFromPNG(pngPath);
    console.log("\n");
    qrcode.generate(qrContent, { small: true });
    console.log("\nScan the QR code above with your Zalo app to login");
    console.log(`
QR image saved at: ${pngPath}
`);
    return pngPath;
  } catch (err) {
    try {
      fs.unlinkSync(pngPath);
    } catch {
    }
    throw new Error(`Failed to display QR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// src/client/credentials.ts
import { readFileSync as readFileSync3, writeFileSync as writeFileSync2, unlinkSync as unlinkSync2, existsSync as existsSync2, chmodSync, mkdirSync, copyFileSync } from "node:fs";
import { join as join2, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";
var DEFAULT_DATA_DIR = "run";
var CREDENTIALS_FILE = "zalo-credentials.json";
var LEGACY_CREDENTIALS_PATH = join2(homedir(), ".openclaw", "zaloclaw-credentials.json");
function getGatewayDataDir(env = process.env) {
  const configured = env.ZALO_GATEWAY_DATA_DIR?.trim() || DEFAULT_DATA_DIR;
  return isAbsolute(configured) ? configured : join2(process.cwd(), configured);
}
function getCredentialsPath(env = process.env) {
  return join2(getGatewayDataDir(env), "credentials", CREDENTIALS_FILE);
}
function migrateLegacyCredentialsIfNeeded(path2 = getCredentialsPath()) {
  if (existsSync2(path2) || !existsSync2(LEGACY_CREDENTIALS_PATH)) return;
  const dir = dirname(path2);
  if (!existsSync2(dir)) mkdirSync(dir, { recursive: true, mode: 448 });
  copyFileSync(LEGACY_CREDENTIALS_PATH, path2);
  try {
    chmodSync(path2, 384);
  } catch {
  }
}
function saveCredentials(data) {
  const path2 = getCredentialsPath();
  const dir = dirname(path2);
  if (!existsSync2(dir)) {
    mkdirSync(dir, { recursive: true, mode: 448 });
  }
  writeFileSync2(path2, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 384 });
  try {
    chmodSync(path2, 384);
  } catch {
  }
}
function loadCredentials() {
  const path2 = getCredentialsPath();
  migrateLegacyCredentialsIfNeeded(path2);
  if (!existsSync2(path2)) {
    return null;
  }
  try {
    const raw = readFileSync3(path2, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function hasCredentials() {
  const path2 = getCredentialsPath();
  migrateLegacyCredentialsIfNeeded(path2);
  return existsSync2(path2);
}

// src/client/zalo-client.ts
import { Zalo, LoginQRCallbackEventType } from "zca-js";
import sharp from "sharp";
import * as fs2 from "fs";
var apiInstance = null;
var currentUid = null;
async function imageMetadataGetter(filePath) {
  const data = await fs2.promises.readFile(filePath);
  const metadata = await sharp(data).metadata();
  return {
    height: metadata.height || 0,
    width: metadata.width || 0,
    size: metadata.size || data.length
  };
}
async function loginWithQR(callback) {
  const zalo = new Zalo({ logging: false, imageMetadataGetter });
  const api = await zalo.loginQR(void 0, (event) => {
    if (event.type === LoginQRCallbackEventType.GotLoginInfo && event.data) {
      saveCredentials({
        imei: event.data.imei,
        cookie: event.data.cookie,
        userAgent: event.data.userAgent
      });
    }
    callback?.(event);
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
function hasStoredCredentials() {
  return hasCredentials();
}

// src/cli/zalo-login.ts
async function main() {
  console.log("[zalo-api-gateway] Starting Zalo QR login...");
  console.log(`[zalo-api-gateway] Data dir: ${getGatewayDataDir()}`);
  console.log(`[zalo-api-gateway] Credentials path: ${getCredentialsPath()}`);
  if (hasStoredCredentials()) {
    console.log("[zalo-api-gateway] Existing credentials found. Attempting refresh login first...");
    try {
      const api2 = await loginWithCredentials();
      const account2 = await api2.fetchAccountInfo().catch(() => void 0);
      console.log("[zalo-api-gateway] Existing credentials are valid.");
      if (account2) console.log(JSON.stringify(account2, null, 2));
      return;
    } catch (err) {
      console.warn(`[zalo-api-gateway] Existing credentials failed: ${err instanceof Error ? err.message : String(err)}`);
      console.warn("[zalo-api-gateway] Falling back to QR login.");
    }
  }
  const api = await loginWithQR(async (event) => {
    if (event.type === LoginQRCallbackEventType2.QRCodeGenerated) {
      await displayQRFromPNG(event.data.image);
      console.log("[zalo-api-gateway] Scan the QR code with a secondary/test Zalo account.");
    }
    if (event.type === LoginQRCallbackEventType2.QRCodeExpired) {
      console.log("[zalo-api-gateway] QR expired. zca-js may retry or abort depending on provider behavior.");
    }
    if (event.type === LoginQRCallbackEventType2.QRCodeScanned) {
      console.log(`[zalo-api-gateway] QR scanned by ${event.data.display_name}. Confirm login in Zalo app.`);
    }
    if (event.type === LoginQRCallbackEventType2.QRCodeDeclined) {
      console.log("[zalo-api-gateway] QR login was declined.");
    }
    if (event.type === LoginQRCallbackEventType2.GotLoginInfo) {
      console.log("[zalo-api-gateway] Login info received and credentials saved.");
    }
  });
  const account = await api.fetchAccountInfo().catch(() => void 0);
  console.log("[zalo-api-gateway] Login complete.");
  if (account) console.log(JSON.stringify(account, null, 2));
}
main().catch((err) => {
  console.error(`[zalo-api-gateway] Login failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
