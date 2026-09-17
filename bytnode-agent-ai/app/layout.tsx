import type { Metadata } from "next";
import { Geist, IBM_Plex_Mono, Inter } from "next/font/google";
import FondMarine from "@/components/fond/fond";
import "./globals.css";

/* Les memes trois voix que BytNode : Geist pour ce qui titre (elle tient la
   grande taille sans s'epaissir), Inter pour ce qui se lit, Plex Mono pour
   les identifiants — ids de modeles, cles, tailles. */
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
  description: "Un agent de dialogue, configuré par vous, branché sur OpenRouter.",
};

/* Le theme est pose sur <html> AVANT la premiere peinture, depuis les reglages
   memorises : sans cela la page clignote du sombre au clair a chaque
   rechargement. Ce script ne vit que dans le layout racine, rendu une seule
   fois par le serveur. */
const THEME_SCRIPT =
  'try{var s=JSON.parse(localStorage.getItem("agentchat:settings")||"{}");' +
  'if(s.theme==="light")document.documentElement.dataset.theme="light"}catch(e){}';

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="fr"
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
