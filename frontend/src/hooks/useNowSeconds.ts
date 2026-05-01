import { useEffect, useState } from "react";

/**
 * Returns current unix time in seconds and refreshes periodically.
 */
export function useNowSeconds(intervalMs: number = 1000): number {
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [intervalMs]);

  return nowSec;
}
