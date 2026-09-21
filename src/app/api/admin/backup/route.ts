import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { readDirectory } from "@/lib/data";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const dateStamp = new Date().toISOString().slice(0, 10);
  const dir = await readDirectory();
  return new NextResponse(JSON.stringify(dir, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="talisay-wsr-backup-${dateStamp}.json"`,
    },
  });
}
