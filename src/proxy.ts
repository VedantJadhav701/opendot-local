import { NextResponse, type NextRequest } from "next/server";

const PORT = process.env.PORT ?? "3100";
const ALLOWED = new Set<string>([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
if (process.env.DOTS_PUBLIC_URL) {
  try {
    ALLOWED.add(new URL(process.env.DOTS_PUBLIC_URL).host);
  } catch {
    /* ignore a malformed value */
  }
}

export function proxy(req: NextRequest) {
  // Defeats DNS rebinding and LAN access: the Host header must be this machine.
  if (!ALLOWED.has(req.headers.get("host") ?? "")) return new NextResponse("Forbidden host", { status: 403 });
  // Browsers always send Origin on cross-site writes. If it is present it must also be this machine.
  const origin = req.headers.get("origin");
  if (origin && req.method !== "GET" && req.method !== "HEAD") {
    try {
      if (!ALLOWED.has(new URL(origin).host)) return new NextResponse("Forbidden origin", { status: 403 });
    } catch {
      return new NextResponse("Forbidden origin", { status: 403 });
    }
  }
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", "img-src 'self' data: blob: https://logos.composio.dev https://cdn.jsdelivr.net;");
  return res;
}

export const middleware = proxy;

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
