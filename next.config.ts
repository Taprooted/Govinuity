import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingExcludes: {
    "/api/harvest": [
      "LICENSE",
      "README.md",
      "docs/**",
      "examples/**",
      "public/**",
      "app/**/*.tsx",
      "next.config.ts",
      "package-lock.json",
      "postcss.config.mjs",
      "tsconfig.json",
    ],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
