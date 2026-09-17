import { cookies } from "next/headers";
import { AUTH_COOKIE, checkPassword, isAuthEnabled, sessionToken } from "@/lib/auth";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAuthEnabled()) return ok({ ok: true, enabled: false });
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!checkPassword(body.password || "")) return fail("Senha incorreta", 401, { code: "bad_password" });
  const jar = await cookies();
  jar.set(AUTH_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return ok({ ok: true, enabled: true });
}
