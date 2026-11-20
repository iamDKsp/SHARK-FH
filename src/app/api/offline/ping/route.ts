import { NextRequest, NextResponse } from "next/server";
import { verifyRequestAuth } from "@/lib/authServer";

export async function GET(request: NextRequest) {
  const auth = await verifyRequestAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  return NextResponse.json(
    {
      ok: true,
      userId: auth.userId,
      serverTime: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
