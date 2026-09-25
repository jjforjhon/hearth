import { useEffect, useState } from "react";

/** Ticks every second toward a deadline (ms epoch). Returns seconds remaining. */
export function useCountdown(deadline: number | null | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(
    deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null,
  );

  useEffect(() => {
    if (!deadline) {
      setRemaining(null);
      return;
    }
    const update = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    const iv = window.setInterval(update, 1000);
    return () => window.clearInterval(iv);
  }, [deadline]);

  return remaining;
}
