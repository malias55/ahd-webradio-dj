import type { NextConfig } from "next";

// One identifier per build, shared by the page code and the server
// (`.next/BUILD_ID`). Open speaker pages compare the two and reload after a
// deployment. Kept in the environment so every build worker uses the same value.
const build = process.env.AHD_BUILD_ID ||= `${(process.env.RAILWAY_GIT_COMMIT_SHA || "local").slice(0, 12)}-${Date.now().toString(36)}`;

const config: NextConfig = {
  reactStrictMode: true,
  generateBuildId: () => build,
  env: { NEXT_PUBLIC_AHD_BUILD: build },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default config;
