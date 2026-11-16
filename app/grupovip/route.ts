import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.redirect(
    "https://chat.whatsapp.com/KVi88nhF7YnD9AkO7UZ3DK",
    302,
  );
}
