const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
require('dotenv').config({ path: './Backend/.env' });

// JWT Secret from environment variables
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

// Configure Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await prisma.user.findUnique({ where: { googleId: profile.id } });

      if (!user) {
        // If no user found by googleId, try to find by email
        user = await prisma.user.findUnique({ where: { email: profile.emails[0].value } });

        if (user) {
          // If user found by email but no googleId, update the user
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              googleId: profile.id,
              avatarUrl: user.avatarUrl || profile.photos[0].value, // Update avatar if not already set
            },
          });
        } else {
          // If no user found by googleId or email, create a new user
          user = await prisma.user.create({
            data: {
              googleId: profile.id,
              email: profile.emails[0].value,
              name: profile.displayName,
              avatarUrl: profile.photos[0].value,
            },
          });
        }
      }
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  }
));

// Serialize and Deserialize user for session management (not strictly needed for JWT, but good practice for passport)
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Helper function to generate JWT token
const generateToken = (user) => {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

// @route POST /api/auth/signup
// @desc Register user
router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;

  try {
    let user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
    });

    const token = generateToken(user);
    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route POST /api/auth/login
// @desc Authenticate user & get token
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route GET /api/auth/google
// @desc Authenticate with Google
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// @route GET /api/auth/google/callback
// @desc Google OAuth callback
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login', session: false }),
  (req, res) => {
    // Successful authentication, generate token and redirect
    const token = generateToken(req.user);
    // Redirect to frontend with token (e.g., http://localhost:3000/auth?token=...)
    res.redirect(`${process.env.CORS_ORIGIN}/auth?token=${token}`);
  }
);

/**
 * GET /api/auth/session
 * Verify JWT token and return user data
 */
router.get('/session', async (req, res) => {
  const token = req.headers.authorization && req.headers.authorization.split(' ')[1];

  if (!token) {
    return res.json({ user: null });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });

    if (!user) {
      return res.json({ user: null });
    }

    res.json({ user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl } });
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    return res.json({ user: null });
  }
});

module.exports = router;
