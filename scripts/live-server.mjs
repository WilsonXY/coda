import { createServer } from '../server.mjs';
import { openMusicSession } from './music-session.mjs';

const controller = new AbortController();
const setupDeadline = setTimeout(() => controller.abort(), 45000);
let session, server;
try {
  session = await openMusicSession(controller.signal);
  clearTimeout(setupDeadline);
  server = createServer({
    liveMusic: (id, signal) => session.open(id, signal),
  });
  server.listen(Number(process.env.PORT ?? 8493), '127.0.0.1', () =>
    console.log('Coda optional live experiment ready'),
  );
  for (const name of ['SIGTERM', 'SIGINT'])
    process.once(name, async () => {
      controller.abort();
      server.closeAllConnections();
      server.close();
      await session.close();
    });
} catch {
  clearTimeout(setupDeadline);
  controller.abort();
  await session?.close();
  console.error('Live experiment setup failed; no live checks passed.');
  process.exitCode = 1;
}
