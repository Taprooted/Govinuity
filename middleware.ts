import { NextRequest, NextResponse } from "next/server";
import { currentMode, LOOPBACK_HOSTS } from "./lib/deployment-mode";

function isLoopbackRequest(request: NextRequest) {
  return LOOPBACK_HOSTS.has(request.nextUrl.hostname);
}

function denied(request: NextRequest, status: number, message: string) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: message }, { status });
  }

  return new NextResponse(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function requestApiKey(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1];
  }

  return request.headers.get("x-govinuity-api-key") ?? request.headers.get("x-api-key");
}

export function middleware(request: NextRequest) {
  const mode = currentMode();

  if (mode === "invalid") {
    return denied(request, 500, "Invalid GOVINUITY_MODE. Use 'local' or 'shared'.");
  }

  if (mode === "local") {
    if (!isLoopbackRequest(request)) {
      return denied(
        request,
        403,
        "Govinuity is running in local mode and only accepts localhost requests.",
      );
    }
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    const expectedApiKey = process.env.GOVINUITY_API_KEY?.trim();
    if (!expectedApiKey) {
      return denied(
        request,
        503,
        "Govinuity shared mode requires GOVINUITY_API_KEY to protect API routes.",
      );
    }

    const providedApiKey = requestApiKey(request)?.trim();
    if (!providedApiKey || providedApiKey !== expectedApiKey) {
      return denied(request, 401, "Unauthorized");
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
