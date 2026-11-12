"use client";
// Scrolls an element into view once, e.g. the pledge PayPal just sent the funder back to.
import { useEffect } from "react";

export function ScrollTo({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ block: "center" });
  }, [id]);
  return null;
}
