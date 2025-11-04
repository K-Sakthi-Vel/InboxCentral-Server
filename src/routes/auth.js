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
  const {
    email,
    password,
    name,
    twilioAccountSid,
    twilioAuthToken,
    twilioSmsFrom,
    twilioWhatsappFrom,
  } = req.body;

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
        twilioAccountSid: twilioAccountSid || null,
        twilioAuthToken: twilioAuthToken || null,
        twilioSmsFrom: twilioSmsFrom || null,
        twilioWhatsappFrom: twilioWhatsappFrom || null,
        isTwilioVerified: false, // Default to false
      },
      include: { teamRoles: true }, // Include teamRoles
    });

    const token = generateToken(user);
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isTwilioVerified: user.isTwilioVerified,
        twilioAccountSid: user.twilioAccountSid,
        twilioAuthToken: user.twilioAuthToken,
        twilioSmsFrom: user.twilioSmsFrom,
        twilioWhatsappFrom: user.twilioWhatsappFrom,
        teamRoles: user.teamRoles, // Include teamRoles
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
    const user = await prisma.user.findUnique({
      where: { email },
      include: { teamRoles: true }, // Include teamRoles
    });
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
        teamRoles: user.teamRoles, // Include teamRoles
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
    let user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { teamRoles: true },
    });

    if (!user) {
      return res.json({ user: null });
    }

    // If the user has no team roles, create a default team and add them to it
    if (!user.teamRoles || user.teamRoles.length === 0) {
      const defaultTeam = await prisma.team.create({
        data: {
          name: `${user.name || user.email}'s Team`,
          members: {
            create: {
              userId: user.id,
              role: 'ADMIN', // Assign as admin of their default team
            },
          },
        },
      });

      // Re-fetch user with the new team role
      user = await prisma.user.findUnique({
        where: { id: user.id },
        include: { teamRoles: true },
      });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isTwilioVerified: user.isTwilioVerified,
        twilioNumber: user.twilioNumber,
        twilioAccountSid: user.twilioAccountSid,
        twilioAuthToken: user.twilioAuthToken,
        twilioSmsFrom: user.twilioSmsFrom,
        twilioWhatsappFrom: user.twilioWhatsappFrom,
        teamRoles: user.teamRoles,
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
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        twilioAccountSid: true,
        twilioAuthToken: true,
        twilioWhatsappFrom: true,
      },
    });

    if (!user || !user.twilioAccountSid || !user.twilioAuthToken || !user.twilioWhatsappFrom) {
      return res.status(400).json({ message: 'Twilio credentials not found for this user.' });
    }

    const success = await sendWhatsappOtp(userId, twilioNumber, {
      twilioAccountSid: user.twilioAccountSid,
      twilioAuthToken: user.twilioAuthToken,
      twilioWhatsappFrom: user.twilioWhatsappFrom,
    });
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
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        twilioAccountSid: true,
        twilioAuthToken: true,
        twilioSmsFrom: true,
        twilioWhatsappFrom: true,
      },
    });

    if (!user || !user.twilioAccountSid || !user.twilioAuthToken || !user.twilioSmsFrom || !user.twilioWhatsappFrom) {
      return res.status(400).json({ message: 'Twilio credentials not found for this user.' });
    }

    const result = await verifyWhatsappOtp(
      userId,
      twilioNumber,
      otp,
      {
        twilioAccountSid: user.twilioAccountSid,
        twilioAuthToken: user.twilioAuthToken,
      },
      user.twilioAccountSid,
      user.twilioAuthToken,
      user.twilioSmsFrom,
      user.twilioWhatsappFrom
    );
    if (result.success) {
      const updatedUser = await prisma.user.findUnique({
        where: { id: userId },
        include: { teamRoles: true }, // Include teamRoles
      });
      res.status(200).json({ message: result.message, user: updatedUser });
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
  const { twilioNumber, twilioAccountSid, twilioAuthToken, twilioSmsFrom, twilioWhatsappFrom } = req.body;
  const userId = req.user.id;

  if (!twilioNumber && !twilioAccountSid && !twilioAuthToken && !twilioSmsFrom && !twilioWhatsappFrom) {
    return res.status(400).json({ message: 'At least one Twilio detail is required for update.' });
  }

  try {
    // Check if the new twilioNumber already exists for another user
    if (twilioNumber) {
      const existingUserWithTwilioNumber = await prisma.user.findFirst({
        where: {
          twilioNumber: twilioNumber,
          id: {
            not: userId, // Exclude the current user
          },
        },
      });

      if (existingUserWithTwilioNumber) {
        return res.status(400).json({ message: 'This Twilio number is already associated with another account.' });
      }
    }

    const updateData = {};
    if (twilioNumber) updateData.twilioNumber = twilioNumber;
    if (twilioAccountSid) updateData.twilioAccountSid = twilioAccountSid;
    if (twilioAuthToken) updateData.twilioAuthToken = twilioAuthToken;
    if (twilioSmsFrom) updateData.twilioSmsFrom = twilioSmsFrom;
    if (twilioWhatsappFrom) updateData.twilioWhatsappFrom = twilioWhatsappFrom;

    // If any Twilio number or credential is being updated, reset verification status
    if (twilioNumber || twilioAccountSid || twilioAuthToken || twilioSmsFrom || twilioWhatsappFrom) {
      updateData.isTwilioVerified = false;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: { teamRoles: true }, // Include teamRoles
    });
    res.status(200).json({
      message: 'Twilio details updated. Please verify the new number if applicable.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isTwilioVerified: user.isTwilioVerified,
        twilioNumber: user.twilioNumber,
        twilioAccountSid: user.twilioAccountSid,
        twilioAuthToken: user.twilioAuthToken,
        twilioSmsFrom: user.twilioSmsFrom,
        twilioWhatsappFrom: user.twilioWhatsappFrom,
        teamRoles: user.teamRoles, // Include teamRoles
      },
    });
  } catch (error) {
    console.error('Error updating Twilio details:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

// @route POST /api/auth/remove-twilio-number
// @desc Remove user's Twilio number and reset verification status
router.post('/remove-twilio-number', protect, async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        twilioNumber: null,
        isTwilioVerified: false,
        twilioAccountSid: null,
        twilioAuthToken: null,
        twilioSmsFrom: null,
        twilioWhatsappFrom: null,
      },
      include: { teamRoles: true }, // Include teamRoles
    });
    res.status(200).json({
      message: 'Twilio verified number removed successfully.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isTwilioVerified: user.isTwilioVerified,
        twilioNumber: user.twilioNumber,
        twilioAccountSid: user.twilioAccountSid,
        twilioAuthToken: user.twilioAuthToken,
        twilioSmsFrom: user.twilioSmsFrom,
        twilioWhatsappFrom: user.twilioWhatsappFrom,
        teamRoles: user.teamRoles, // Include teamRoles
      },
    });
  } catch (error) {
    console.error('Error removing Twilio details:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
