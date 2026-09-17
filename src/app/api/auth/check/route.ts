import { cookies } from "next/headers";
import { AUTH_COOKIE, isAuthEnabled, isValidSession } from "@/lib/auth";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const valid = await isValidSession(jar.get(AUTH_COOKIE)?.value);
  return valid ? ok({ ok: true, enabled: isAuthEnabled() }) : fail("Não autenticado", 401, { code: "auth_required" });
}
