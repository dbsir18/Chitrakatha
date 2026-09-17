import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "chitrakatha" });

/**
 * True when a durable executor is reachable: either an explicit event key
 * (Inngest Cloud, set on Vercel) or dev mode (the local `inngest-cli dev`
 * server on :8288, via INNGEST_DEV=1). When false, the app falls back to the
 * after() executor, so plain local dev keeps working with zero setup.
 */
export function inngestConfigured(): boolean {
  return (
    !!process.env.INNGEST_EVENT_KEY ||
    process.env.INNGEST_DEV === "1" ||
    process.env.INNGEST_DEV === "true"
  );
}
