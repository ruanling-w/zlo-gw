import "../env/load-dotenv.js";
import { LoginQRCallbackEventType } from "zca-js";
import { displayQRFromPNG } from "../client/qr-display.js";
import { getCredentialsPath, getGatewayDataDir } from "../client/credentials.js";
import { hasStoredCredentials, loginWithCredentials, loginWithQR } from "../client/zalo-client.js";

async function main(): Promise<void> {
  console.log("[zalo-api-gateway] Starting Zalo QR login...");
  console.log(`[zalo-api-gateway] Data dir: ${getGatewayDataDir()}`);
  console.log(`[zalo-api-gateway] Credentials path: ${getCredentialsPath()}`);
  if (hasStoredCredentials()) {
    console.log("[zalo-api-gateway] Existing credentials found. Attempting refresh login first...");
    try {
      const api = await loginWithCredentials();
      const account = await api.fetchAccountInfo().catch(() => undefined);
      console.log("[zalo-api-gateway] Existing credentials are valid.");
      if (account) console.log(JSON.stringify(account, null, 2));
      return;
    } catch (err) {
      console.warn(`[zalo-api-gateway] Existing credentials failed: ${err instanceof Error ? err.message : String(err)}`);
      console.warn("[zalo-api-gateway] Falling back to QR login.");
    }
  }

  const api = await loginWithQR(async (event) => {
    if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
      await displayQRFromPNG(event.data.image);
      console.log("[zalo-api-gateway] Scan the QR code with a secondary/test Zalo account.");
    }
    if (event.type === LoginQRCallbackEventType.QRCodeExpired) {
      console.log("[zalo-api-gateway] QR expired. zca-js may retry or abort depending on provider behavior.");
    }
    if (event.type === LoginQRCallbackEventType.QRCodeScanned) {
      console.log(`[zalo-api-gateway] QR scanned by ${event.data.display_name}. Confirm login in Zalo app.`);
    }
    if (event.type === LoginQRCallbackEventType.QRCodeDeclined) {
      console.log("[zalo-api-gateway] QR login was declined.");
    }
    if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
      console.log("[zalo-api-gateway] Login info received and credentials saved.");
    }
  });

  const account = await api.fetchAccountInfo().catch(() => undefined);
  console.log("[zalo-api-gateway] Login complete.");
  if (account) console.log(JSON.stringify(account, null, 2));
}

main().catch((err) => {
  console.error(`[zalo-api-gateway] Login failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
