import type { Metadata } from "next";
import { Geist, IBM_Plex_Mono, Inter } from "next/font/google";
import FondMarine from "@/components/fond/fond";
import "./globals.css";

/* The same three voices as BytNode: Geist for what titles (it holds the
   large size without thickening), Inter for what is read, Plex Mono for
   identifiers — model ids, keys, sizes. */
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["300", "400", "500"],
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "BytNode-AI",
  description: "A conversational agent, configured by you, connected to OpenRouter.",
};

/* The theme is set on <html> BEFORE the first paint, from the saved
   settings: without it the page flashes from dark to light on every reload.
   This script lives only in the root layout, rendered once by the server. */
const THEME_SCRIPT =
  'try{var s=JSON.parse(localStorage.getItem("agentchat:settings")||"{}");' +
  'if(s.theme==="light")document.documentElement.dataset.theme="light"}catch(e){}';

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${inter.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <FondMarine />
        {children}
      </body>
    </html>
  );
}
