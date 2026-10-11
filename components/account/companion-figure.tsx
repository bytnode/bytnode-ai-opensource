"use client";

import { useRef } from "react";
import { useCompanion, type Mood } from "@/components/chat/companion";

/* The app's companion — the floating agent's body (`companion.ts`) — on
   the first pages (user request, 2026-10-09: the welcome felt empty and
   fade; « une DA qui reprend plus la DA de l'application »). The same
   shader at any size: it breathes, blinks, follows the pointer; smiles
   under `hover`, works (blue eyes, a sweep) under `busy`. Without WebGL 2
   it simply is not drawn. */
export function CompanionFigure({ size, mood, className }: { size: number; mood?: Partial<Mood>; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCompanion(ref, { busy: false, waiting: false, unread: false, hover: false, dragging: false, ...mood }, true);
  return <canvas ref={ref} className={className} style={{ width: size, height: size }} aria-hidden="true" />;
}
