"use client";
// Re-renders the page's server data every few seconds while the tab is visible, so PayPal
// webhook updates show up without a reload.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
