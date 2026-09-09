import { cookies } from "next/headers";
import { AUTH_COOKIE, checkPassword, isAuthEnabled, sessionToken } from "@/lib/auth";
import { fail, ok } from "@/lib/api";

export async function POST(req: Request) {
  if (!isAuthEnabled()) return ok({ ok: true });
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!checkPassword(body.password || "")) return fail("Senha incorreta", 401);
  const jar = await cookies();
  jar.set(AUTH_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return ok({ ok: true });
}
