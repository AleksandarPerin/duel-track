import { useCountdown } from '../hooks/useCountdown';

const LOW_TIME_THRESHOLD_SECONDS = 5 * 60; // matches the 5-minute warning threshold in PRD NOT-03

function formatClock(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '+' : '';
  const abs = Math.round(Math.abs(totalSeconds));
  const mm = Math.floor(abs / 60);
  const ss = abs % 60;
  return `${sign}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function RoundTimer({
  status,
  startedAt,
  timerMinutes,
}: {
  // Plain string, not RoundStatus — used identically by the authenticated
  // RoundPage (whose Round.status is the typed union) and the public
  // export's TournamentExportRound.status (a plain string), and this
  // component only ever compares against the literal 'active'.
  status: string;
  startedAt: string | null | undefined;
  timerMinutes: number;
}) {
  const remainingSeconds = useCountdown(status === 'active' ? startedAt : undefined, timerMinutes);

  if (status !== 'active' || remainingSeconds == null) return null;

  const expired = remainingSeconds <= 0;
  const lowTime = !expired && remainingSeconds <= LOW_TIME_THRESHOLD_SECONDS;

  const className = ['round-timer', lowTime && 'round-timer--low', expired && 'round-timer--expired']
    .filter(Boolean)
    .join(' ');

  return (
    // aria-live="off" is deliberate: a live region that fires every second would spam screen readers
    <div className={className} role="timer" aria-live="off">
      <span className="round-timer__clock">{formatClock(remainingSeconds)}</span>
      <span className="round-timer__label">{expired ? 'Time expired — overtime' : 'Time remaining'}</span>
    </div>
  );
}
