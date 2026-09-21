import { NextResponse } from "next/server";
import { readDirectory } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const dir = await readDirectory();
  return NextResponse.json(dir.meta);
}
