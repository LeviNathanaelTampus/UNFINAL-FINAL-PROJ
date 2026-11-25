'use strict';
const mongoose = require('mongoose');
const { env } = require('./env');

mongoose.set('strictQuery', true);

let connected = false;
let listenersAttached = false;

async function connectDB() {
  if (!listenersAttached) attachListeners();
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
  });
  // Build indexes defined in schemas (partial unique indexes matter for integrity)
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes().catch((e) => {
    console.error(`[db] Index sync failed for ${m.modelName}:`, e.message);
  })));
}

function attachListeners() {
  listenersAttached = true;
  mongoose.connection.on('connected', () => {
    connected = true;
    console.log('[db] Connected to MongoDB');
  });
  mongoose.connection.on('disconnected', () => {
    connected = false;
    console.warn('[db] Disconnected from MongoDB');
  });
  mongoose.connection.on('error', (err) => {
    console.error('[db] Connection error:', err.message);
  });
}

function isDbReady() {
  return connected && mongoose.connection.readyState === 1;
}

module.exports = { connectDB, isDbReady };
