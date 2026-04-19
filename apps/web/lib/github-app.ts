import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function parsePrivateKey(value: string): string {
  const unescaped = value.replace(/\\n/g, "\n").trim();
  if (unescaped.includes("BEGIN") && unescaped.includes("PRIVATE KEY")) {
    return unescaped;
  }
  const decoded = Buffer.from(value, "base64").toString("utf-8").trim();
  if (decoded.includes("BEGIN") && decoded.includes("PRIVATE KEY")) {
    return decoded;
  }
  throw new Error("Invalid GITHUB_APP_PRIVATE_KEY format");
}

function loadPrivateKey(): string {
  const inline = process.env.GITHUB_APP_PRIVATE_KEY;
  if (inline) return parsePrivateKey(inline);

  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (keyPath) {
    const resolved = path.isAbsolute(keyPath)
      ? keyPath
      : path.resolve(process.cwd(), keyPath);
    return fs.readFileSync(resolved, "utf-8").trim();
  }

  throw new Error(
    "GitHub App private key not configured. Set GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH",
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/[=]/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function mintAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) {
    throw new Error("GITHUB_APP_ID must be set");
  }
  const privateKey = loadPrivateKey();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: Number(appId) }),
  );
  const data = `${header}.${payload}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(data), privateKey);
  return `${data}.${base64url(sig)}`;
}

async function findInstallationId(owner: string): Promise<number | null> {
  const jwt = mintAppJwt();
  const res = await fetch("https://api.github.com/app/installations", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "User-Agent": "machina-factory-dashboard",
    },
  });
  if (!res.ok) return null;
  const installations = (await res.json()) as Array<{
    id: number;
    account: { login: string } | null;
  }>;
  const match = installations.find(
    (i) => i.account?.login?.toLowerCase() === owner.toLowerCase(),
  );
  return match?.id ?? null;
}

export async function getInstallationToken(
  owner: string,
): Promise<string | null> {
  const installationId = await findInstallationId(owner);
  if (installationId === null) return null;
  const jwt = mintAppJwt();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "User-Agent": "machina-factory-dashboard",
      },
    },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { token: string };
  return data.token;
}
