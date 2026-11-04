import { AppError } from '../errors/AppError';
import { registerUser } from '../auth/auth.service';
import { createTournament, addGuestPlayer } from '../tournaments/tournament.service';
import { writeAuditLog } from '../audit/audit.service';

// A local demo: the UI has no sign-up or create-tournament screen yet, so this
// creates an organizer and a tournament with enough players to start it
// (`npm run seed:demo`). Uses the services behind the API routes, skipping
// their request validation, and writes the same audit entries they do.
export const DEMO_ORGANIZER = {
  email: 'organizer@demo.dueltrack.test',
  password: 'dueltrack-demo-organizer',
  displayName: 'Demo Organizer',
};

const DEMO_PLAYERS = 8; // the minimum to start a tournament

// The demo login is public, so it must never land in a shared database.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export async function seedDemo(): Promise<{ tournamentId: string }> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data in production');
  }
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to seed demo data outside a local database (DATABASE_URL host is ${host})`);
  }

  let organizer;
  try {
    organizer = await registerUser(DEMO_ORGANIZER.email, DEMO_ORGANIZER.displayName, DEMO_ORGANIZER.password);
  } catch (err) {
    if (err instanceof AppError && err.code === 'EMAIL_TAKEN') {
      throw new Error(
        `Demo data is already seeded; log in as ${DEMO_ORGANIZER.email}. ` +
          'If an earlier run failed partway, `npm run docker:reset`, migrate and seed again.',
      );
    }
    throw err;
  }

  const tournament = await createTournament(organizer.id, {
    name: 'Demo Friday Night Magic',
    format: 'modern',
    rel_level: 'regular',
    total_rounds: 3,
    top_cut: 0,
  });
  await writeAuditLog({
    tournamentId: tournament.id,
    actorId: organizer.id,
    action: 'tournament.created',
    entityType: 'tournament',
    entityId: tournament.id,
    detail: { name: tournament.name, format: tournament.format },
  });
  for (let i = 1; i <= DEMO_PLAYERS; i++) {
    const player = await addGuestPlayer(tournament.id, organizer.id, `Demo Player ${i}`);
    await writeAuditLog({
      tournamentId: tournament.id,
      actorId: organizer.id,
      action: 'player.added',
      entityType: 'tournament_player',
      entityId: player.id,
      detail: { display_name: player.display_name, sort_seed: player.sort_seed },
    });
  }
  return { tournamentId: tournament.id };
}
