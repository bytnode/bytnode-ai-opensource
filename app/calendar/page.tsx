"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { openView } from "@/lib/state/tabs";

/* A link straight to the Calendar tab: it opens the view in the app's tab
   bar and hands over to the app. The tab itself lives at "/", like every
   other page of the app. */
export default function CalendarLink() {
  const router = useRouter();
  useEffect(() => {
    openView("calendar");
    router.replace("/");
  }, [router]);
  return null;
}
