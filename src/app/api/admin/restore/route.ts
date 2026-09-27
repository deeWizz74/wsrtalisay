import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { writeDirectory } from "@/lib/data";
import type { DirectoryData, Group, Person, Ward } from "@/lib/types";

function isPerson(v: unknown): v is Person {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.photo === "string" &&
    typeof p.messenger === "string" &&
    typeof p.phone === "string" &&
    typeof p.email === "string"
  );
}

function isGroup(v: unknown): v is Group {
  if (!v || typeof v !== "object") return false;
  const g = v as Record<string, unknown>;
  if (typeof g.role !== "string") return false;
  if (!Array.isArray(g.people) || !g.people.every(isPerson)) return false;
  if (g.viceChair !== undefined && !isGroup(g.viceChair)) return false;
  return true;
}

function isWard(v: unknown): v is Ward {
  if (!v || typeof v !== "object") return false;
  const w = v as Record<string, unknown>;
  if (typeof w.slug !== "string" || typeof w.name !== "string") return false;
  if (!isGroup(w.lead)) return false;
  if (!Array.isArray(w.roles) || !w.roles.every(isGroup)) return false;
  if (w.leadership !== undefined && (!Array.isArray(w.leadership) || !w.leadership.every(isGroup))) return false;
  if (w.secretary !== undefined && !isGroup(w.secretary)) return false;
  return true;
}

function isDirectoryData(v: unknown): v is DirectoryData {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  const meta = d.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta.title !== "string" || typeof meta.updatedAt !== "string" || typeof meta.roleLegend !== "object") {
    return false;
  }
  if (!Array.isArray(d.wards) || !d.wards.every(isWard)) return false;
  const info = d.info as Record<string, unknown> | undefined;
  if (!info || !Array.isArray(info.pefFaq) || !Array.isArray(info.spotlight) || !Array.isArray(info.wsrEfforts)) {
    return false;
  }
  return true;
}

// Restores directory data from a backup file — the counterpart to
// /api/admin/backup. Overwrites the entire live dataset, so it's gated
// behind admin auth just like every other write path.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!isDirectoryData(body)) {
    return NextResponse.json(
      { error: "That file doesn't match the expected backup format" },
      { status: 400 },
    );
  }

  await writeDirectory(body);
  return NextResponse.json({ ok: true });
}
