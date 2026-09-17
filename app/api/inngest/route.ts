import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { generateLessonFunction } from "@/lib/inngest/lesson-generation";

/**
 * Serves the Inngest functions for remote invocation. The Inngest dev
 * server (`npx inngest-cli dev -u http://localhost:3001/api/inngest`)
 * registers this endpoint locally; in production, Inngest Cloud calls it
 * with the signing key set on Vercel.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateLessonFunction],
});
