import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isAuthEnabled, isValidSession } from "@/lib/auth";

/**
 * Proteção opcional por senha (APP_PASSWORD). Sem a variável, tudo passa.
 * O cookie é validado aqui mesmo (Web Crypto), sem chamadas internas.
 */
export async function proxy(request: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) return NextResponse.next();

  if (await isValidSession(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Não autenticado", code: "auth_required" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
