import { cookies } from "next/headers";

const AUTH_COOKIE = "machina-factory-auth";
const STUDIO_SESSION_COOKIE =
  process.env.MACHINA_SESSION_COOKIE_NAME || "machina_session_key";
/** Short-lived cookie minted after a signed Studio ctx is verified, so
 *  follow-up navigation inside the iframe (to /factory/<id>, /factory, …)
 *  doesn't have to carry ?ctx= on every request. */
const STUDIO_IFRAME_COOKIE = "factory-studio-auth";
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const STUDIO_IFRAME_SESSION_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Check if the dashboard requires authentication.
 * If FACTORY_DASHBOARD_PASSWORD is not set, dashboard is open (dev mode).
 */
export function isAuthRequired(): boolean {
  return Boolean(process.env.FACTORY_DASHBOARD_PASSWORD);
}

function hasValidStudioSession(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return false;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    );
    return typeof payload.exp === "number" && payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

function hasValidIframeSession(token: string): boolean {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
    return decoded.valid === true && decoded.expires > Date.now();
  } catch {
    return false;
  }
}

/**
 * Check if the current request is authenticated.
 *
 * Accepts three auth modes:
 *   1. Native Factory password cookie (`machina-factory-auth`).
 *   2. Machina Studio session JWT (`machina_session_key`) forwarded via
 *      the same-origin rewrite from Studio. Validated by expiry only — the
 *      upstream Studio middleware has already performed trust checks.
 *   3. Short-lived iframe-session cookie (`factory-studio-auth`) set after
 *      a valid signed ctx token was verified. Lets subsequent navigation
 *      inside the Studio-embedded iframe (e.g. redirect to /factory/<id>
 *      after creating a job) stay authenticated without re-minting a ctx.
 */
export async function isAuthenticated(): Promise<boolean> {
  if (!isAuthRequired()) return true;

  const cookieStore = await cookies();

  const studioSession = cookieStore.get(STUDIO_SESSION_COOKIE)?.value;
  if (studioSession && hasValidStudioSession(studioSession)) return true;

  const iframeSession = cookieStore.get(STUDIO_IFRAME_COOKIE)?.value;
  if (iframeSession && hasValidIframeSession(iframeSession)) return true;

  const token = cookieStore.get(AUTH_COOKIE)?.value;
  if (!token) return false;

  try {
    const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
    return decoded.valid === true && decoded.expires > Date.now();
  } catch {
    return false;
  }
}

/**
 * Persist a short-lived cookie after a signed Studio ctx has been verified.
 * Cross-origin iframe (Studio embeds Factory) requires `sameSite: none` +
 * `secure` so the cookie is sent on navigation inside the iframe. On
 * localhost `secure` is tolerated because browsers special-case localhost.
 */
export async function grantStudioIframeSession(): Promise<void> {
  const token = Buffer.from(
    JSON.stringify({
      valid: true,
      expires: Date.now() + STUDIO_IFRAME_SESSION_DURATION,
    }),
  ).toString("base64");

  const cookieStore = await cookies();
  cookieStore.set(STUDIO_IFRAME_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: STUDIO_IFRAME_SESSION_DURATION / 1000,
    path: "/",
  });
}

/**
 * Validate a password and set the auth cookie.
 */
export async function login(password: string): Promise<boolean> {
  if (password !== process.env.FACTORY_DASHBOARD_PASSWORD) {
    return false;
  }

  const token = Buffer.from(
    JSON.stringify({
      valid: true,
      expires: Date.now() + SESSION_DURATION,
    }),
  ).toString("base64");

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DURATION / 1000,
    path: "/",
  });

  return true;
}

/**
 * Clear the auth cookie.
 */
export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
}
