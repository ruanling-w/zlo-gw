import type { JsonResponse } from "../types.js";
import { hasStoredCredentials, loginWithCredentials, loginWithQR } from "../../client/zalo-client.js";
import { LoginQRCallbackEventType } from "zca-js";

type LoginStatus = "idle" | "refreshing" | "qr_generated" | "scanned" | "authenticated" | "expired" | "declined" | "failed";

type LoginSession = {
  sessionId: string;
  status: LoginStatus;
  qrImageBase64?: string;
  displayName?: string;
  error?: string;
  startedAt: number;
};

let session: LoginSession | undefined;
let loginPromise: Promise<void> | undefined;

function json(status: number, body: unknown, headers?: Record<string, string>): JsonResponse {
  return { status, body, headers };
}

function publicSession(): LoginSession | { status: "idle"; authenticatedHint: boolean } {
  return session ?? { status: "idle", authenticatedHint: hasStoredCredentials() };
}

export async function startLoginQrResponse(): Promise<JsonResponse> {
  if (loginPromise && session) return json(200, { ok: true, data: publicSession() });

  session = {
    sessionId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: hasStoredCredentials() ? "refreshing" : "idle",
    startedAt: Date.now(),
  };

  loginPromise = (async () => {
    try {
      if (hasStoredCredentials()) {
        try {
          await loginWithCredentials();
          if (session) session.status = "authenticated";
          return;
        } catch {
          if (session) session.status = "idle";
        }
      }
      await loginWithQR((event) => {
        if (!session) return;
        if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
          session.status = "qr_generated";
          session.qrImageBase64 = event.data.image;
        }
        if (event.type === LoginQRCallbackEventType.QRCodeScanned) {
          session.status = "scanned";
          session.displayName = event.data.display_name;
        }
        if (event.type === LoginQRCallbackEventType.QRCodeExpired) session.status = "expired";
        if (event.type === LoginQRCallbackEventType.QRCodeDeclined) session.status = "declined";
        if (event.type === LoginQRCallbackEventType.GotLoginInfo) session.status = "authenticated";
      });
      if (session) session.status = "authenticated";
    } catch (err) {
      if (session) {
        session.status = "failed";
        session.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      loginPromise = undefined;
    }
  })();

  return json(202, { ok: true, data: publicSession() });
}

export function loginQrStatusResponse(): JsonResponse {
  return json(200, { ok: true, data: publicSession() });
}

export function loginQrImageResponse(): JsonResponse {
  if (!session?.qrImageBase64) return json(404, { ok: false, error: "QR image is not available" });
  const body = Buffer.from(session.qrImageBase64, "base64");
  return {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": body.length.toString(),
    },
    body,
  };
}
