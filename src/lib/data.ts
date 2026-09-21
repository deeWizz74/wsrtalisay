import "server-only";
import fs from "fs";
import path from "path";
import { get, put, del } from "@vercel/blob";
import seedDirectory from "../../data/directory.json";
import type { DirectoryData, Group, Person, Ward, Stats } from "./types";

const DIRECTORY_BLOB_PATH = "data/directory.json";

// Vercel deployments always have BLOB_READ_WRITE_TOKEN set (Storage → Blob),
// so production uses Blob storage. Without it — plain `npm run dev` on a
// machine with no Vercel project linked yet — fall back to the local disk,
// mirroring the old Render-era storage, so the app is testable standalone.
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

const LOCAL_DATA_DIR = path.join(process.cwd(), "data");
const LOCAL_DIRECTORY_FILE = path.join(LOCAL_DATA_DIR, "directory.json");
const LOCAL_UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

async function fetchDirectoryBlob(): Promise<DirectoryData | null> {
  if (!USE_BLOB) {
    if (!fs.existsSync(LOCAL_DIRECTORY_FILE)) return null;
    return JSON.parse(fs.readFileSync(LOCAL_DIRECTORY_FILE, "utf8")) as DirectoryData;
  }
  const result = await get(DIRECTORY_BLOB_PATH, { access: "public" });
  if (!result) return null;
  return (await new Response(result.stream).json()) as DirectoryData;
}

export async function writeDirectory(dir: DirectoryData): Promise<void> {
  dir.meta.updatedAt = new Date().toISOString();
  if (!USE_BLOB) {
    fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });
    fs.writeFileSync(LOCAL_DIRECTORY_FILE, JSON.stringify(dir, null, 2));
    return;
  }
  await put(DIRECTORY_BLOB_PATH, JSON.stringify(dir, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function readDirectory(): Promise<DirectoryData> {
  // First read on a fresh deploy: the blob store starts empty, so seed it
  // from the JSON committed to the repo and persist that as the baseline.
  let dir = await fetchDirectoryBlob();
  if (!dir) {
    dir = structuredClone(seedDirectory) as DirectoryData;
    await writeDirectory(dir);
  }

  if (!dir.info) {
    dir.info = { pefFaq: [], spotlight: [], wsrEfforts: [] };
  }
  // Migrate older posts stored as a single `body` string into the block-based
  // `content` shape (one text block), so old data keeps working after the
  // inline-image feature replaced the plain-text body.
  for (const post of dir.info.wsrEfforts) {
    const legacy = post as unknown as { body?: string; content?: unknown };
    if (!Array.isArray(legacy.content)) {
      post.content = legacy.body ? [{ id: `${post.id}-text`, type: "text", text: legacy.body }] : [];
      delete legacy.body;
    }
  }
  return dir;
}

// Uploads a photo and returns its URL — a full blob URL in production, or a
// `/uploads/...` public-folder path in the local-disk fallback.
export async function uploadPhoto(pathname: string, file: File): Promise<string> {
  if (!USE_BLOB) {
    fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });
    const filename = path.basename(pathname);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(path.join(LOCAL_UPLOADS_DIR, filename), buffer);
    return `/uploads/${filename}`;
  }
  const blob = await put(pathname, file, { access: "public", addRandomSuffix: false });
  return blob.url;
}

// Deletes a previously uploaded photo. Silently ignores missing files/blobs.
export async function deletePhoto(url: string): Promise<void> {
  if (!url) return;
  if (!USE_BLOB) {
    if (!url.startsWith("/uploads/")) return;
    const local = path.join(process.cwd(), "public", url);
    if (fs.existsSync(local)) fs.unlinkSync(local);
    return;
  }
  if (!url.startsWith("http")) return;
  await del(url).catch(() => {});
}

// A specialist role chairs its own area (viceChair), and a stake-level
// secretary reports directly to the WSR specialist — both are optional
// extra groups beyond the ward's core leadership/lead/roles structure.
export function wardGroups(ward: Ward): Group[] {
  const groups: Group[] = [...(ward.leadership || []), ward.lead, ...ward.roles];
  for (const r of ward.roles) {
    if (r.viceChair) groups.push(r.viceChair);
  }
  if (ward.secretary) groups.push(ward.secretary);
  return groups;
}

export interface FoundPerson {
  ward: Ward;
  group: Group;
  person: Person;
  idx: number;
}

export function findPerson(dir: DirectoryData, personId: string): FoundPerson | null {
  for (const ward of dir.wards) {
    for (const group of wardGroups(ward)) {
      const idx = group.people.findIndex((p) => p.id === personId);
      if (idx !== -1) return { ward, group, person: group.people[idx], idx };
    }
  }
  return null;
}

export interface PersonContext {
  person: Person;
  role: string;
  wardName: string;
}

export function allPeopleWithContext(dir: DirectoryData): PersonContext[] {
  const result: PersonContext[] = [];
  for (const ward of dir.wards) {
    for (const group of wardGroups(ward)) {
      for (const person of group.people) {
        if (person.name.trim()) {
          result.push({ person, role: group.role, wardName: ward.name });
        }
      }
    }
  }
  return result;
}

export function computeStats(dir: DirectoryData): Stats {
  let filledRoleSlots = 0;
  let totalRoleSlots = 0;
  let totalPeople = 0;
  let peopleWithMessenger = 0;

  for (const ward of dir.wards) {
    const roleGroups = [ward.lead, ...ward.roles];
    for (const g of roleGroups) {
      totalRoleSlots += 1;
      if (g.people.length > 0) filledRoleSlots += 1;
    }
    for (const g of wardGroups(ward)) {
      for (const p of g.people) {
        totalPeople += 1;
        if (p.messenger) peopleWithMessenger += 1;
      }
    }
  }

  return {
    wardsCount: dir.wards.length,
    totalRoleSlots,
    filledRoleSlots,
    vacantRoleSlots: totalRoleSlots - filledRoleSlots,
    totalPeople,
    peopleWithMessenger,
  };
}
