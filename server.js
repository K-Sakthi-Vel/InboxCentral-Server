// server.js
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');

const { prisma } = require('./src/lib/db');

const authRouter = require('./src/routes/auth');
const webhooksRouter = require('./src/routes/webhooks');
const messagesRouter = require('./src/routes/messages');
const inboxRouter = require('./src/routes/inbox');
const settingsRouter = require('./src/routes/settings');

const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();

/** Middlewares */
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors({ origin: CORS_ORIGIN }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

/** Health */
app.get('/', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    console.log("db_connection_failed", err)
    res.status(500).json({ ok: false, error: 'db_connection_failed' });
  }
});

/** Mount routers under /api */
app.use('/api/auth', authRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/inbox', inboxRouter);
app.use('/api/settings', settingsRouter);

/** 404 fallback */
app.use((req, res) => res.status(404).json({ error: 'not_found' }));

/** Start server */
const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  if (process.env.START_SCHEDULER === 'true') {
    // not recommended in production; for dev convenience only
    try {
      require('./src/workers/scheduler');
      console.log('Scheduler started in same process (START_SCHEDULER=true)');
    } catch (err) {
      console.error('Failed to start scheduler automatically', err);
    }
  }
});

/** Graceful shutdown */
async function shutdown() {
  console.log('Shutting down...');
  server.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (e) {
      console.error('Error during prisma disconnect', e);
    } finally {
      process.exit(0);
    }
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
