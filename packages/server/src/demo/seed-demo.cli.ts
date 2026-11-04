// npm run seed:demo — see seedDemo.ts.
import { pool } from '../db/pool';
import { seedDemo, DEMO_ORGANIZER } from './seedDemo';

seedDemo()
  .then(({ tournamentId }) => {
    console.log(`Seeded tournament ${tournamentId} with 8 players.`);
    console.log(`Log in at http://localhost:5173 as ${DEMO_ORGANIZER.email} / ${DEMO_ORGANIZER.password}`);
  })
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
