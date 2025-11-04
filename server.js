// server.js
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const passport = require('passport');
const jwt = require('jsonwebtoken');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const authRouter = require('./src/routes/auth');
const webhooksRouter = require('./src/routes/webhooks');
const messagesRouter = require('./src/routes/messages');
const inboxRouter = require('./src/routes/inbox');
const settingsRouter = require('./src/routes/settings');
const notesRouter = require('./src/routes/notes');

const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();

/** Middlewares */
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors({ origin: CORS_ORIGIN }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(passport.initialize()); // Initialize passport

// JWT Strategy for protecting routes
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;

const opts = {};
opts.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken();
opts.secretOrKey = process.env.JWT_SECRET;

passport.use(new JwtStrategy(opts, async (jwt_payload, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: jwt_payload.id } });
    if (user) {
      return done(null, user);
    }
    return done(null, false);
  } catch (error) {
    return done(error, false);
  }
}));

// Middleware to protect routes
const authenticateJWT = passport.authenticate('jwt', { session: false });

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
app.use('/api/messages', authenticateJWT, messagesRouter); // Protect messages routes
app.use('/api/inbox', authenticateJWT, inboxRouter);       // Protect inbox routes
app.use('/api/settings', authenticateJWT, settingsRouter); // Protect settings routes
app.use('/api/notes', authenticateJWT, notesRouter);       // Protect notes routes

/** 404 fallback */
app.use((req, res) => res.status(404).json({ error: 'not_found' }));

/** Start server */
const { initSocket } = require('./src/lib/socket'); // Import initSocket

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

// Setup Socket.IO
const io = initSocket(server, CORS_ORIGIN); // Initialize Socket.IO

/** Graceful shutdown */
async function shutdown() {
  console.log('Shutting down...');
  io.close(() => {
    console.log('Socket.IO server closed.');
  });
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
