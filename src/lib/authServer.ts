import { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "solucoes-financeiras-super-secret-key-2026"
);

export interface AuthUser {
  userId: string;
  email?: string;
  nome?: string;
}

export function extractAuthToken(request: NextRequest | Request): string | undefined {
  if ("cookies" in request && typeof request.cookies?.get === "function") {
    const cookieVal = request.cookies.get("sol_auth_token")?.value;
    if (cookieVal) return cookieVal;
  }
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(";").map((c) => c.trim());
  const match = parts.find((c) => c.startsWith("sol_auth_token="));
  return match ? decodeURIComponent(match.slice("sol_auth_token=".length)) : undefined;
}

export async function verifyRequestAuth(request: NextRequest | Request): Promise<AuthUser | null> {
  const token = extractAuthToken(request);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.sub ? String(payload.sub) : "";
    if (!userId) return null;
    return {
      userId,
      email: payload.email ? String(payload.email) : undefined,
      nome: payload.nome ? String(payload.nome) : undefined,
    };
  } catch {
    return null;
  }
}
