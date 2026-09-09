import { cookies } from "next/headers";
import { AUTH_COOKIE } from "@/lib/auth";
import { ok } from "@/lib/api";

export async function POST() {
  const jar = await cookies();
  jar.delete(AUTH_COOKIE);
  return ok({ ok: true });
}
