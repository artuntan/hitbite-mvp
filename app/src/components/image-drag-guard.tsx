"use client";
import { useEffect } from "react";
export function ImageDragGuard() {
  useEffect(() => {
    const preventImageDrag = (event: DragEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("img, picture, svg")
      )
        event.preventDefault();
    };
    document.addEventListener("dragstart", preventImageDrag, true);
    return () =>
      document.removeEventListener("dragstart", preventImageDrag, true);
  }, []);
  return null;
}
