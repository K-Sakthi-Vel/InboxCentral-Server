const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsappOtp, verifyWhatsappOtp } = require('../lib/twilio'); // Import Twilio functions
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
  const { email, password, name, twilioNumber } = req.body;

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
        twilioNumber: twilioNumber || null, // Save twilioNumber if provided
        isTwilioVerified: false, // Default to false
      },
    });

    const token = generateToken(user);
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isTwilioVerified: user.isTwilioVerified,
        twilioNumber: user.twilioNumber,
      },
    });
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
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isTwilioVerified: user.isTwilioVerified,
        twilioNumber: user.twilioNumber,
      },
    });
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

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isTwilioVerified: user.isTwilioVerified,
        twilioNumber: user.twilioNumber,
      },
    });
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    return res.json({ user: null });
  }
});

// Middleware to protect routes (optional, can be used for specific routes)
const protect = (req, res, next) => {
  const token = req.headers.authorization && req.headers.authorization.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// @route POST /api/auth/request-twilio-otp
// @desc Request OTP for Twilio number verification
router.post('/request-twilio-otp', protect, async (req, res) => {
  const { twilioNumber } = req.body;
  const userId = req.user.id; // User ID from JWT token

  if (!twilioNumber) {
    return res.status(400).json({ message: 'Twilio number is required.' });
  }

  try {
    const success = await sendWhatsappOtp(userId, twilioNumber);
    if (success) {
      res.status(200).json({ message: 'OTP sent successfully to your WhatsApp.' });
    } else {
      res.status(500).json({ message: 'Failed to send OTP.' });
    }
  } catch (error) {
    console.error('Error requesting Twilio OTP:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

// @route POST /api/auth/verify-twilio-otp
// @desc Verify OTP for Twilio number
router.post('/verify-twilio-otp', protect, async (req, res) => {
  const { twilioNumber, otp } = req.body;
  const userId = req.user.id; // User ID from JWT token

  if (!twilioNumber || !otp) {
    return res.status(400).json({ message: 'Twilio number and OTP are required.' });
  }

  try {
    const result = await verifyWhatsappOtp(userId, twilioNumber, otp);
    if (result.success) {
      res.status(200).json({ message: result.message });
    } else {
      res.status(400).json({ message: result.message });
    }
  } catch (error) {
    console.error('Error verifying Twilio OTP:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

// @route PUT /api/auth/update-twilio-number
// @desc Update user's Twilio number and reset verification status
router.put('/update-twilio-number', protect, async (req, res) => {
  const { twilioNumber } = req.body;
  const userId = req.user.id;

  if (!twilioNumber) {
    return res.status(400).json({ message: 'Twilio number is required.' });
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        twilioNumber: twilioNumber,
        isTwilioVerified: false, // Reset verification status
      },
    });
    res.status(200).json({
      message: 'Twilio number updated. Please verify the new number.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isTwilioVerified: user.isTwilioVerified,
        twilioNumber: user.twilioNumber,
      },
    });
  } catch (error) {
    console.error('Error updating Twilio number:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
