import { env } from "cloudflare:workers";

export const ADMIN_USERNAME = "admin";
export const SESSION_COOKIE = "ro_admin_session";

const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

type AuthBindings = {
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
};

function bindings() {
  return env as unknown as AuthBindings;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey() {
  const secret = bindings().ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("管理员会话密钥尚未配置");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function safeEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = left.length === right.length ? 0 : 1;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

export async function verifyAdminCredentials(username: string, password: string) {
  const configuredPassword = bindings().ADMIN_PASSWORD;
  if (!configuredPassword) throw new Error("管理员密码尚未配置");
  const [usernameMatches, passwordMatches] = await Promise.all([
    safeEqual(username, ADMIN_USERNAME),
    safeEqual(password, configuredPassword),
  ]);
  return usernameMatches && passwordMatches;
}

export async function createSessionToken(now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + SESSION_SECONDS;
  const payload = `${ADMIN_USERNAME}.${expiresAt}`;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(payload));
  return `${expiresAt}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token?: string | null, now = Date.now()) {
  if (!token) return false;
  const [expiresValue, signatureValue, extra] = token.split(".");
  if (!expiresValue || !signatureValue || extra) return false;
  const expiresAt = Number(expiresValue);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  try {
    return crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      base64UrlToBytes(signatureValue),
      encoder.encode(`${ADMIN_USERNAME}.${expiresAt}`),
    );
  } catch {
    return false;
  }
}

export function sessionFromCookieHeader(cookieHeader: string | null) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return null;
}

export async function isAdminRequest(request: Request) {
  return verifySessionToken(sessionFromCookieHeader(request.headers.get("cookie")));
}

export function sessionCookie(token: string, secure: boolean) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}
