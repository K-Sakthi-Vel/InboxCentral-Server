// src/routes/settings.js
const express = require('express');
const router = express.Router();

/**
 * GET /api/settings/twilio/numbers
 * Returns purchased Twilio incoming phone numbers (for settings UI)
 */
router.get('/twilio/numbers', async (req, res) => {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) return res.json({ numbers: [] });

    const Twilio = require('twilio');
    const client = Twilio(accountSid, authToken);
    const incoming = await client.incomingPhoneNumbers.list({ limit: 20 });
    const numbers = incoming.map((n) => ({ sid: n.sid, phoneNumber: n.phoneNumber, friendlyName: n.friendlyName }));
    return res.json({ numbers });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('/api/settings/twilio/numbers error', err);
    return res.status(500).json({ error: 'internal_error', detail: String(err) });
  }
});

module.exports = router;
