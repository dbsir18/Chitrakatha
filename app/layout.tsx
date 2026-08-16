import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import Link from "next/link";
import { BookOpenText } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Chitrakatha — Visual Memory Palaces",
  description:
    "Turn dense medical content into an illustrated memory palace: one scene, a symbol for every fact, and a quiz.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b border-border/70 bg-background/90 backdrop-blur-sm sticky top-0 z-40">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-center gap-2 group">
              <BookOpenText className="size-5 text-ink-600 group-hover:text-gold-600 transition-colors" strokeWidth={1.75} />
              <span className="font-heading font-semibold tracking-tight text-lg text-ink-900">
                Chitrakatha
              </span>
            </Link>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Memory Palaces for Medicine
            </span>
          </div>
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
