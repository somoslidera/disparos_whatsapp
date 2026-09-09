import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "disparos_session";

/**
 * Proteção opcional por senha (APP_PASSWORD). A validação do cookie acontece
 * no servidor (/api/auth/check) porque o runtime deste arquivo não tem acesso ao crypto do Node.
 */
export async function proxy(request: NextRequest) {
  if (!process.env.APP_PASSWORD) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) return NextResponse.next();

  const cookie = request.cookies.get(COOKIE)?.value;
  if (cookie) {
    const check = await fetch(new URL("/api/auth/check", request.url), {
      headers: { cookie: `${COOKIE}=${cookie}` },
      cache: "no-store",
    }).catch(() => null);
    if (check?.ok) return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
