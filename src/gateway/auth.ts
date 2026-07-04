import type { IncomingMessage } from "node:http";

export function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || undefined;
}

export function isAuthorized(request: IncomingMessage, expectedToken?: string): boolean {
  if (!expectedToken) return true;
  return extractBearerToken(request.headers.authorization) === expectedToken;
}

export function requireBearerToken(request: IncomingMessage, expectedToken?: string): { ok: true } | { ok: false; status: number; error: string } {
  if (isAuthorized(request, expectedToken)) return { ok: true };
  return { ok: false, status: 401, error: "Unauthorized" };
}
