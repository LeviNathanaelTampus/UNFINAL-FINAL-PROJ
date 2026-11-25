'use strict';
const { env, assertRequired } = require('./config/env');

assertRequired();

const app = require('./app');
const { connectDB } = require('./config/db');

async function start() {
  // Start HTTP first so the static site and /api/health respond even while the DB reconnects.
  const server = app.listen(env.port, () => {
    console.log(`[server] GoodNeighbor Health running at http://localhost:${env.port}`);
    console.log(`[server] AI: ${env.gemini.enabled ? `enabled (${env.gemini.model})` : 'disabled (no GEMINI_API_KEY)'} · Email: ${env.gmail.enabled ? 'enabled' : 'disabled (Gmail API not configured)'}`);
  });

  const tryConnect = async (attempt = 1) => {
    try {
      await connectDB();
    } catch (err) {
      const wait = Math.min(30, attempt * 5);
      console.error(`[db] Could not connect (attempt ${attempt}): ${err.message}. Retrying in ${wait}s…`);
      setTimeout(() => tryConnect(attempt + 1), wait * 1000);
    }
  };
  tryConnect();

  const shutdown = (sig) => {
    console.log(`[server] ${sig} received, shutting down`);
    server.close(() => {
      require('mongoose').connection.close(false).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[server] Unhandled rejection:', reason instanceof Error ? reason.message : reason);
  });
}

start();
