import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Cloudflare rejects the default Node user agent on www.krea.ai.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const RESOURCE = "https://api.krea.ai/mcp";
const REGISTER_URL = "https://www.krea.ai/auth/v1/oauth/clients/register";
const AUTHORIZE_URL = "https://www.krea.ai/auth/v1/oauth/authorize";
const TOKEN_URL = "https://www.krea.ai/auth/v1/oauth/token";
const SESSION_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".krea-session.json");

export class KreaAuthError extends Error {
  constructor(message) {
    super(message);
    this.code = "auth";
  }
}

let queue = Promise.resolve();

function scrub(message, secrets) {
  let text = String(message || "Krea sign-in failed");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 8) text = text.split(secret).join("[secret]");
  }
  return text.slice(0, 300);
}

function same(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

async function readSession() {
  try {
    const data = JSON.parse(await readFile(SESSION_PATH, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

async function writeSession(data) {
  const tmp = `${SESSION_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
  await rename(tmp, SESSION_PATH);
}

function update(mutator) {
  const run = queue.then(async () => {
    const current = await readSession();
    const next = await mutator(current);
    if (next !== current) await writeSession(next);
    return next;
  });
  queue = run.then(
    () => {},
    () => {},
  );
  return run;
}

async function registerClient(redirectUri) {
  const response = await fetch(REGISTER_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      client_name: "Factcut",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "profile email",
    }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.client_id) {
    throw new KreaAuthError(
      scrub(body.error_description || body.message || `Krea client registration returned ${response.status}`, []),
    );
  }
  return body.client_id;
}

async function requestToken(fields, secrets) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    const error = new KreaAuthError(
      scrub(body.error_description || body.error || `Krea token exchange returned ${response.status}`, secrets),
    );
    error.invalidGrant = body.error === "invalid_grant" || response.status === 400;
    throw error;
  }
  return body;
}

function applyTokens(session, tokens) {
  const expiresIn = Number(tokens.expires_in);
  return {
    ...session,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || session.refreshToken || "",
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
    pending: null,
    lastError: "",
  };
}

export async function kreaStatus() {
  const session = await readSession();
  const connected = Boolean(session.accessToken || session.refreshToken);
  return {
    connected,
    error: connected ? "" : session.lastError || "",
  };
}

export async function startKreaConnect(redirectUri) {
  const session = await update(async (current) => {
    let clientId = current.clientId;
    if (!clientId || current.redirectUri !== redirectUri) {
      clientId = await registerClient(redirectUri);
    }
    const state = randomBytes(16).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    return {
      ...current,
      clientId,
      redirectUri,
      pending: { state, verifier, redirectUri, createdAt: Date.now() },
      lastError: "",
    };
  });
  const verifier = session.pending?.verifier || "";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", session.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "profile email");
  url.searchParams.set("state", session.pending.state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", RESOURCE);
  return url;
}

export async function finishKreaConnect({ code, state, redirectUri }) {
  await update(async (current) => {
    const pending = current.pending;
    const fresh = pending && Date.now() - Number(pending.createdAt || 0) < 10 * 60 * 1000;
    if (!fresh || !same(pending.state, state) || pending.redirectUri !== redirectUri) {
      return {
        ...current,
        pending: null,
        lastError: "Krea sign-in did not finish. Connect again.",
      };
    }
    try {
      const tokens = await requestToken(
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: current.clientId,
          code_verifier: pending.verifier,
          resource: RESOURCE,
        },
        [code, pending.verifier, current.clientId],
      );
      return applyTokens(current, tokens);
    } catch (error) {
      return {
        ...current,
        pending: null,
        accessToken: "",
        refreshToken: "",
        expiresAt: 0,
        lastError: error instanceof Error ? error.message : "Krea sign-in did not finish. Connect again.",
      };
    }
  });
  const status = await kreaStatus();
  if (!status.connected) {
    throw new KreaAuthError(status.error || "Krea sign-in did not finish. Connect again.");
  }
}

export async function kreaAccessToken({ force = false } = {}) {
  const session = await update(async (current) => {
    if (!current.accessToken && !current.refreshToken) {
      throw new KreaAuthError("Connect Krea to paint the still. Sign in and pick the Pro workspace.");
    }
    const usable =
      current.accessToken && (!current.expiresAt || current.expiresAt - 60000 > Date.now());
    if (!force && usable) return current;
    if (!current.refreshToken) {
      if (current.accessToken && !force) return current;
      throw new KreaAuthError("Connect Krea again. The sign-in expired.");
    }
    try {
      const tokens = await requestToken(
        {
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
          client_id: current.clientId,
          resource: RESOURCE,
        },
        [current.refreshToken, current.accessToken, current.clientId],
      );
      return applyTokens(current, tokens);
    } catch (error) {
      if (error.invalidGrant) {
        return {
          ...current,
          accessToken: "",
          refreshToken: "",
          expiresAt: 0,
          lastError: "Connect Krea again. The sign-in expired.",
        };
      }
      throw error;
    }
  });
  if (!session.accessToken) {
    throw new KreaAuthError(session.lastError || "Connect Krea again. The sign-in expired.");
  }
  return session.accessToken;
}
