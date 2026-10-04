import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop app ships .next/standalone: a minimal server.js plus only the node_modules it needs.
  output: "standalone",
  serverExternalPackages: ["pdf-parse"],
  // Runtime data is found through process.cwd(), so tracing would copy it in. It must never ship.
  outputFileTracingExcludes: { "*": [".data/**", ".env*", ".gstack/**", "dist/**", "scripts/**"] },
  // The floating dev badge sits on top of the sidebar's Settings link.
  devIndicators: false,
};

export default nextConfig;
