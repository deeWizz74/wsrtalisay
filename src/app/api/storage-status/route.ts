import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public, non-secret diagnostic: reports which storage backend this
// deployment is actually using, so a Blob-token misconfiguration shows up
// immediately instead of only surfacing as "edits don't sync."
export async function GET() {
  return NextResponse.json({
    storage: process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local-disk",
  });
}
