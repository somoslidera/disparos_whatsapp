import { cookies } from "next/headers";
import { AUTH_COOKIE, isValidSession } from "@/lib/auth";
import { fail, ok } from "@/lib/api";

export async function GET() {
  const jar = await cookies();
  return isValidSession(jar.get(AUTH_COOKIE)?.value) ? ok({ ok: true }) : fail("Não autenticado", 401);
}
