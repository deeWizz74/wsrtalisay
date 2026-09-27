import "server-only";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

const SESSION_COOKIE = "wsr_session";
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours

interface AdminRecord {
  username: string;
  passwordHash: string;
}

// Same Blob-vs-local-disk split as src/lib/data.ts: production (Vercel) has
// BLOB_READ_WRITE_TOKEN set; local dev without it falls back to disk.
//
// Unlike directory data and photos, admin credentials and the
// session-signing secret are real secrets — but a single Vercel Blob store
// can only be all-public or all-private, never both, and the store used
// here is public (photos need direct public URLs). So in Blob mode these
// secrets aren't persisted to Blob at all: the admin account comes straight
// from ADMIN_USER/ADMIN_PASS env vars (no signup, no stored hash, no
// separate password-change flow — update the env vars and redeploy
// instead), and the session secret is a per-process random value unless
// SESSION_SECRET is set (set it to keep sessions valid across redeploys).
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL_DATA_DIR = path.join(process.cwd(), "data");
const ADMIN_LOCAL_FILE = path.join(LOCAL_DATA_DIR, "admin.json");
const SECRET_LOCAL_FILE = path.join(LOCAL_DATA_DIR, "session-secret.txt");

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

let cachedSecret: string | null = null;

async function getSessionSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;

  if (USE_BLOB) {
    cachedSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
    return cachedSecret;
  }

  if (!fs.existsSync(SECRET_LOCAL_FILE)) {
    fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_LOCAL_FILE, crypto.randomBytes(32).toString("hex"));
  }
  cachedSecret = fs.readFileSync(SECRET_LOCAL_FILE, "utf8");
  return cachedSecret;
}

// Single admin account, no public signup. Set ADMIN_USER/ADMIN_PASS in the
// environment for a stable login that survives a redeploy; on the
// local-disk fallback, a random password is generated once and printed to
// the server log if those aren't set.
function bootstrapLocalAdmin(): AdminRecord {
  if (fs.existsSync(ADMIN_LOCAL_FILE)) {
    return JSON.parse(fs.readFileSync(ADMIN_LOCAL_FILE, "utf8")) as AdminRecord;
  }
  fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });
  const username = process.env.ADMIN_USER || "admin";
  const password = process.env.ADMIN_PASS || crypto.randomBytes(6).toString("base64url");
  const passwordHash = bcrypt.hashSync(password, 10);
  const record: AdminRecord = { username, passwordHash };
  fs.writeFileSync(ADMIN_LOCAL_FILE, JSON.stringify(record, null, 2));
  console.log("========================================================");
  console.log(" Admin account created:");
  console.log("   username:", username);
  console.log("   password:", password);
  console.log(" Log in at /admin/login and change the password after.");
  console.log("========================================================");
  return record;
}

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  if (USE_BLOB) {
    const envUser = process.env.ADMIN_USER;
    const envPass = process.env.ADMIN_PASS;
    if (!envUser || !envPass) return false;
    return timingSafeEqualStr(username, envUser) && timingSafeEqualStr(password || "", envPass);
  }
  const admin = bootstrapLocalAdmin();
  return username === admin.username && bcrypt.compareSync(password || "", admin.passwordHash);
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  if (USE_BLOB) {
    return {
      ok: false,
      error: "Admin login is set via ADMIN_USER/ADMIN_PASS environment variables on this deployment — update them there and redeploy to change it.",
    };
  }
  const admin = bootstrapLocalAdmin();
  if (!bcrypt.compareSync(currentPassword || "", admin.passwordHash)) {
    return { ok: false, error: "Current password is incorrect" };
  }
  if (!newPassword || newPassword.length < 6) {
    return { ok: false, error: "New password must be at least 6 characters" };
  }
  admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  fs.writeFileSync(ADMIN_LOCAL_FILE, JSON.stringify(admin, null, 2));
  return { ok: true };
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

async function issueToken(username: string): Promise<string> {
  const secret = await getSessionSecret();
  const payload = Buffer.from(JSON.stringify({ username, exp: Date.now() + SESSION_MAX_AGE * 1000 })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload, secret)}`;
}

async function verifyToken(token: string | undefined): Promise<{ username: string } | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const secret = await getSessionSecret();
  if (sign(payload, secret) !== signature) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { username: data.username };
  } catch {
    return null;
  }
}

export async function createSession(username: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await issueToken(username), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<{ username: string } | null> {
  const store = await cookies();
  return verifyToken(store.get(SESSION_COOKIE)?.value);
}
