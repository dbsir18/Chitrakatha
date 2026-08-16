import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse uses Node.js fs to load test fixtures at import time,
  // which breaks Next.js bundling. Opting it out makes it use native require().
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
