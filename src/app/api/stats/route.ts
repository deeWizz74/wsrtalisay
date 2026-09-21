import { NextResponse } from "next/server";
import { readDirectory, computeStats } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const dir = await readDirectory();
  return NextResponse.json(computeStats(dir));
}
