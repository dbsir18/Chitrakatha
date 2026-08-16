import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages use Node.js-specific APIs (fs, canvas, native modules) and
  // must not be bundled by Next.js — they use native require() instead.
  serverExternalPackages: ["pdf-parse", "@react-pdf/renderer"],
};

export default nextConfig;
