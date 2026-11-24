import { useEffect, useState } from "react";

const sec = () => Math.floor(Date.now() / 1000);

/** Unix seconds, refreshed every `ms`. Only the small components that show elapsed time call this, so the tick never reaches the chat or terminal below them. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(sec);
  useEffect(() => {
    setNow(sec());
    const t = setInterval(() => setNow(sec()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** 1 s while a turn runs (the elapsed time moves), otherwise once a minute (stale and age boundaries only). */
export const tickMs = (state?: string) => (state === "running" || state === "thinking" || state === "tool" ? 1000 : 60000);
