import "server-only";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { get, put } from "@vercel/blob";

const ADMIN_BLOB_PATH = "data/admin.json";
const SECRET_BLOB_PATH = "data/session-secret.txt";

const SESSION_COOKIE = "wsr_session";
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours

interface AdminRecord {
  username: string;
  passwordHash: string;
}

// Same Blob-vs-local-disk split as src/lib/data.ts: production (Vercel) has
// BLOB_READ_WRITE_TOKEN set and uses Blob storage; local dev without it
// falls back to the local disk so the app runs standalone.
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL_DATA_DIR = path.join(process.cwd(), "data");

// Admin credentials and the session-signing secret hold real secrets (a
// password hash, an HMAC key), so on Blob they're stored as *private* blobs
// — readable only with the server's BLOB_READ_WRITE_TOKEN, never by URL —
// unlike the directory data and photos, which are meant to be public.
async function readPrivateText(blobPath: string, localFile: string): Promise<string | null> {
  if (!USE_BLOB) {
    if (!fs.existsSync(localFile)) return null;
    return fs.readFileSync(localFile, "utf8");
  }
  const result = await get(blobPath, { access: "private" });
  if (!result) return null;
  return await new Response(result.stream).text();
}

async function writePrivateText(blobPath: string, localFile: string, contents: string): Promise<void> {
  if (!USE_BLOB) {
    fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });
    fs.writeFileSync(localFile, contents);
    return;
  }
  await put(blobPath, contents, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/plain",
  });
}

const ADMIN_LOCAL_FILE = path.join(LOCAL_DATA_DIR, "admin.json");
const SECRET_LOCAL_FILE = path.join(LOCAL_DATA_DIR, "session-secret.txt");

let cachedSecret: string | null = null;

async function getSessionSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  let secret = await readPrivateText(SECRET_BLOB_PATH, SECRET_LOCAL_FILE);
  if (!secret) {
    secret = crypto.randomBytes(32).toString("hex");
    await writePrivateText(SECRET_BLOB_PATH, SECRET_LOCAL_FILE, secret);
  }
  cachedSecret = secret;
  return secret;
}

// Single admin account, no public signup. Set ADMIN_USER/ADMIN_PASS in the
// environment for a stable login that survives a redeploy; otherwise a
// random password is generated once and printed to the server log.
export async function bootstrapAdmin(): Promise<AdminRecord> {
  const existing = await readPrivateText(ADMIN_BLOB_PATH, ADMIN_LOCAL_FILE);
  if (existing) return JSON.parse(existing) as AdminRecord;

  const username = process.env.ADMIN_USER || "admin";
  const password = process.env.ADMIN_PASS || crypto.randomBytes(6).toString("base64url");
  const passwordHash = bcrypt.hashSync(password, 10);
  const record: AdminRecord = { username, passwordHash };
  await writePrivateText(ADMIN_BLOB_PATH, ADMIN_LOCAL_FILE, JSON.stringify(record, null, 2));
  console.log("========================================================");
  console.log(" Admin account created:");
  console.log("   username:", username);
  console.log("   password:", password);
  console.log(" Log in at /admin/login and change the password after.");
  console.log("========================================================");
  return record;
}

async function readAdmin(): Promise<AdminRecord> {
  return bootstrapAdmin();
}

async function writeAdmin(admin: AdminRecord): Promise<void> {
  await writePrivateText(ADMIN_BLOB_PATH, ADMIN_LOCAL_FILE, JSON.stringify(admin, null, 2));
}

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const admin = await readAdmin();
  return username === admin.username && bcrypt.compareSync(password || "", admin.passwordHash);
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await readAdmin();
  if (!bcrypt.compareSync(currentPassword || "", admin.passwordHash)) {
    return { ok: false, error: "Current password is incorrect" };
  }
  if (!newPassword || newPassword.length < 6) {
    return { ok: false, error: "New password must be at least 6 characters" };
  }
  admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  await writeAdmin(admin);
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
