import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { readDirectory, writeDirectory, findPerson, deletePhoto } from "@/lib/data";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const dir = await readDirectory();
  const found = findPerson(dir, id);
  if (!found) return NextResponse.json({ error: "Person not found" }, { status: 404 });

  const body = await req.json();
  const { name, messenger, phone, email, calling } = body;
  if (typeof name === "string") found.person.name = name.trim();
  if (typeof messenger === "string") found.person.messenger = messenger.trim();
  if (typeof phone === "string") found.person.phone = phone.trim();
  if (typeof email === "string") found.person.email = email.trim();
  if (typeof calling === "string") {
    const trimmed = calling.trim();
    if (trimmed) found.person.calling = trimmed;
    else delete found.person.calling;
  }
  await writeDirectory(dir);
  return NextResponse.json(found.person);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const dir = await readDirectory();
  const found = findPerson(dir, id);
  if (!found) return NextResponse.json({ error: "Person not found" }, { status: 404 });

  if (found.person.photo) await deletePhoto(found.person.photo);
  found.group.people.splice(found.idx, 1);
  await writeDirectory(dir);
  return NextResponse.json({ ok: true });
}
