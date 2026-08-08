import type { Request, Response } from "express";
import { config } from "../config.js";

export const ACCESS_COOKIE = "ai_center_session";
export const REFRESH_COOKIE = "ai_center_refresh";
export const MFA_COOKIE = "ai_center_mfa";

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.cookie ?? "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        const key = index >= 0 ? part.slice(0, index) : part;
        const value = index >= 0 ? part.slice(index + 1) : "";
        return [decodeURIComponent(key), decodeURIComponent(value)];
      })
  );
}

function cookie(name: string, value: string, maxAgeSeconds: number): string {
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(request: Request, name: string): string {
  return parseCookies(request)[name] ?? "";
}

export function setSessionCookies(
  response: Response,
  accessToken: string,
  refreshToken: string,
  accessExpiresAt: number
): void {
  response.append("Set-Cookie", cookie(
    ACCESS_COOKIE,
    accessToken,
    Math.max(1, Math.floor((accessExpiresAt - Date.now()) / 1000))
  ));
  response.append("Set-Cookie", cookie(REFRESH_COOKIE, refreshToken, 7 * 24 * 3600));
}

export function setMfaCookie(response: Response, token: string): void {
  response.append("Set-Cookie", cookie(MFA_COOKIE, token, 5 * 60));
}

export function clearAuthCookies(response: Response): void {
  response.append("Set-Cookie", cookie(ACCESS_COOKIE, "", 0));
  response.append("Set-Cookie", cookie(REFRESH_COOKIE, "", 0));
  response.append("Set-Cookie", cookie(MFA_COOKIE, "", 0));
}
