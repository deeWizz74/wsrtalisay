import { NextResponse } from "next/server";
import path from "path";
import { getSessionUser } from "@/lib/auth";
import { readDirectory, writeDirectory, uploadPhoto, deletePhoto } from "@/lib/data";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE = 5 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const dir = await readDirectory();
  const post = dir.info.wsrEfforts.find((e) => e.id === id);
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("photo");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Only image files are allowed" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File is too large (max 5MB)" }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase() || ".jpg";
  const filename = `effort-${id}-${Date.now()}${ext}`;
  const url = await uploadPhoto(`uploads/${filename}`, file);

  if (post.photo) await deletePhoto(post.photo);
  post.photo = url;
  await writeDirectory(dir);
  return NextResponse.json(post);
}
