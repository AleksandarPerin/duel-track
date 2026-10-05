import type { AuditLogView } from '@dueltrack/shared';

// detail is free-form JSONB written per action (see each route's safeAudit
// call on the server) — read fields defensively, since older rows or a
// future payload change must still render as *something* readable.
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function withWarning(text: string, detail: Record<string, unknown>): string {
  const warning = str(detail.warning);
  return warning ? `${text} (warning: ${warning})` : text;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Column names as an organizer would say them; anything unrecognised is
// shown as-is rather than dropped.
const SETTING_LABELS: Record<string, string> = {
  name: 'name',
  venue: 'venue',
  scheduled_at: 'start time',
};

function describeResult(entry: AuditLogView): string {
  const { detail, context } = entry;
  const p1 = context.player1_name ?? 'Player 1';
  const p2 = context.player2_name ?? 'Player 2';
  const p1Wins = num(detail.player1_game_wins) ?? 0;
  const p2Wins = num(detail.player2_game_wins) ?? 0;
  const drawn = num(detail.games_drawn) ?? 0;
  // Winner's games first; a drawn game is a third number (2–1–1), as written
  // on a match slip — without it a 1–1–1 draw would read as 1–1.
  const score = (a: number, b: number) => (drawn > 0 ? `${a}–${b}–${drawn}` : `${a}–${b}`);

  let outcome: string;
  switch (detail.outcome) {
    case 'player1_win':
      outcome = `${p1} won ${score(p1Wins, p2Wins)}`;
      break;
    case 'player2_win':
      outcome = `${p2} won ${score(p2Wins, p1Wins)}`;
      break;
    case 'draw':
      outcome = `draw ${score(p1Wins, p2Wins)}`;
      break;
    case 'intentional_draw':
      outcome = 'intentional draw';
      break;
    case 'double_loss':
      outcome = 'double loss';
      break;
    default:
      outcome = str(detail.outcome) ?? 'unknown outcome';
  }

  const where =
    context.round_number != null && context.table_number != null
      ? ` for Round ${context.round_number}, Table ${context.table_number}`
      : '';
  return `Entered result${where}: ${p1} vs ${p2} — ${outcome}`;
}

// detail.forced_results is a count; forced_breakdown (written since it was
// added) says how they were settled. Older entries only have the count.
function describeForcedResults(detail: Record<string, unknown>): string | null {
  const forced = num(detail.forced_results) ?? 0;
  if (forced === 0) return null;
  const matches = plural(forced, 'unfinished match', 'unfinished matches');

  const breakdown = detail.forced_breakdown;
  if (!breakdown || typeof breakdown !== 'object') return `${matches} given forced results`;
  const { double_losses, losses_for } = breakdown as Record<string, unknown>;
  const doubleLosses = num(double_losses) ?? 0;
  const lossNames = Array.isArray(losses_for) ? losses_for.filter((n): n is string => typeof n === 'string') : [];
  const parts = [
    doubleLosses > 0 ? plural(doubleLosses, 'double loss', 'double losses') : null,
    lossNames.length > 0 ? `${lossNames.length === 1 ? 'a loss' : 'losses'} for ${lossNames.join(', ')}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? `${matches} settled as ${parts.join(' and ')}` : `${matches} given forced results`;
}

export function describeAuditEntry(entry: AuditLogView): string {
  const { detail, context } = entry;
  const player = context.player_name;
  const user = context.user_name;

  switch (entry.action) {
    case 'tournament.created': {
      const name = str(detail.name);
      return name ? `Created the tournament "${name}"` : 'Created the tournament';
    }
    case 'tournament.updated': {
      const fields = Object.keys(detail).map((k) => SETTING_LABELS[k] ?? k);
      return fields.length > 0 ? `Updated tournament settings: ${fields.join(', ')}` : 'Updated tournament settings';
    }
    case 'tournament.registration_opened':
      return 'Opened registration';
    case 'tournament.started':
      return withWarning(`Started the tournament and paired Round ${num(detail.round_number) ?? 1}`, detail);
    case 'round.completed':
      if (detail.tournament_completed === true) {
        return `Closed the final round (Round ${num(detail.final_round) ?? '?'}) — tournament completed`;
      }
      return withWarning(`Closed the previous round and paired Round ${num(detail.round_number) ?? '?'}`, detail);
    case 'round.force_advanced': {
      const reason = str(detail.reason);
      const base =
        detail.tournament_completed === true
          ? `Force-closed the final round (Round ${num(detail.final_round) ?? '?'})`
          : `Force-advanced to Round ${num(detail.round_number) ?? '?'}`;
      const parts = [
        base,
        describeForcedResults(detail),
        reason ? `reason: "${reason}"` : null,
      ].filter((p): p is string => p !== null);
      return withWarning(parts.join(' — '), detail);
    }
    case 'standings.published':
      return `Published Round ${num(detail.round_number) ?? '?'} standings`;
    case 'result.entered':
      return describeResult(entry);
    case 'player.added':
      return `Added player ${str(detail.display_name) ?? player ?? '(unknown)'}`;
    case 'player.removed': {
      // display_name is stored at removal time (the row is deleted with it);
      // entries written before that have neither and stay anonymous.
      const name = str(detail.display_name) ?? player;
      return name ? `Removed player ${name}` : 'Removed a player';
    }
    case 'players.imported': {
      const errors = num(detail.errors) ?? 0;
      return `Imported players from CSV: ${num(detail.imported) ?? 0} added, ${num(detail.skipped) ?? 0} skipped${
        errors > 0 ? `, ${errors} with errors` : ''
      }`;
    }
    case 'player.seeds_reordered':
      return `Reordered seeding for ${num(detail.count) ?? '?'} players`;
    case 'player.dropped': {
      const round = num(detail.drop_round);
      const text = `Dropped ${player ?? 'a player'}${round != null ? ` in Round ${round}` : ''}`;
      return detail.auto_result ? `${text} — their open match was recorded as a loss` : text;
    }
    case 'judge.assigned':
      return user ? `Assigned ${user} as a judge` : 'Assigned a judge';
    case 'judge.removed':
      return user ? `Removed ${user} as a judge` : 'Removed a judge';
    case 'registration.submitted':
      return 'Submitted a registration';
    case 'registration.approved':
      return `Approved the registration of ${str(detail.guest_name) ?? user ?? 'a player'}`;
    case 'registration.rejected':
      if (detail.auto_rejected === true) return 'Auto-rejected a duplicate registration (player already registered)';
      return `Rejected the registration of ${str(detail.guest_name) ?? user ?? 'a player'}`;
    case 'player.claimed':
      return `Claimed the guest record "${str(detail.guest_name) ?? player ?? '?'}"`;
    case 'player.linked_by_organizer':
      return `Linked the guest record "${str(detail.guest_name) ?? player ?? '?'}" to ${user ?? 'a user account'}`;
    default:
      return entry.action;
  }
}
