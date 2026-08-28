import { useEffect, useState } from 'react';

function computeRemainingSeconds(startedAt: string, timerMinutes: number): number {
  const elapsedMs = Date.now() - Date.parse(startedAt);
  return timerMinutes * 60 - elapsedMs / 1000;
}

export function useCountdown(startedAt: string | null | undefined, timerMinutes: number): number | null {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(() =>
    startedAt ? computeRemainingSeconds(startedAt, timerMinutes) : null,
  );

  useEffect(() => {
    if (!startedAt) {
      setRemainingSeconds(null);
      return;
    }
    setRemainingSeconds(computeRemainingSeconds(startedAt, timerMinutes));
    const intervalId = setInterval(() => {
      setRemainingSeconds(computeRemainingSeconds(startedAt, timerMinutes));
    }, 1000);
    return () => clearInterval(intervalId);
  }, [startedAt, timerMinutes]);

  return remainingSeconds;
}
