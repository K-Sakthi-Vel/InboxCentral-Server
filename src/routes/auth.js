// src/routes/auth.js
const express = require('express');
const router = express.Router();

/**
 * GET /api/auth/session
 * Simple demo session stub. Replace with Better Auth in production.
 */
router.get('/session', (req, res) => {
  const demoEmail = process.env.DEV_DEMO_USER_EMAIL;
  if (demoEmail) {
    return res.json({ user: { id: 'demo-user', email: demoEmail, name: 'Demo User' } });
  }
  return res.json({ user: null });
});

module.exports = router;
