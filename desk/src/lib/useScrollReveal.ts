import { useEffect, type RefObject } from "react";

/** Adds `is-scrolling` to the element while it scrolls; removes it 800ms after the last scroll. */
export function attachScrollReveal(el: HTMLElement): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  const on = () => {
    el.classList.add("is-scrolling");
    clearTimeout(t);
    t = setTimeout(() => el.classList.remove("is-scrolling"), 800);
  };
  el.addEventListener("scroll", on, { passive: true });
  return () => { clearTimeout(t); el.removeEventListener("scroll", on); el.classList.remove("is-scrolling"); };
}

export function useScrollReveal(ref: RefObject<HTMLElement | null>) {
  useEffect(() => (ref.current ? attachScrollReveal(ref.current) : undefined), [ref]);
}
