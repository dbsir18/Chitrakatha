import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages use Node.js-specific APIs (fs, canvas, native modules) and
  // must not be bundled by Next.js — they use native require() instead.
  serverExternalPackages: ["pdf-parse", "@react-pdf/renderer"],
  images: {
    // Vercel Blob public URLs (scene + symbol images). Vercel injects this
    // automatically in production, but local dev needs it explicitly or any
    // lesson with a saved image 500s the page.
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
};

export default nextConfig;
