// src/routes/webhooks.js
const express = require('express');
const { validateTwilioRequest, parseTwilioWebhook } = require('../lib/integrations');
const { prisma } = require('../lib/db');

const router = express.Router();

/**
 * POST /api/webhooks/twilio
 */
router.post('/twilio', async (req, res) => {
  try {
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const headers = req.headers || {};
    const valid = validateTwilioRequest({ url: fullUrl, headers, form: req.body });
    if (!valid) return res.status(403).send('Invalid Twilio signature');

    const normalized = parseTwilioWebhook(req.body);

    // Team resolution (demo)
    const defaultTeamName = process.env.DEFAULT_TEAM_NAME || 'Demo Team';
    let team = await prisma.team.findFirst({ where: { name: defaultTeamName } });
    if (!team) team = await prisma.team.create({ data: { name: defaultTeamName } });

    const phoneNormalized = (normalized.from || '').replace(/^whatsapp:/, '');
    let contact = await prisma.contact.findFirst({ where: { teamId: team.id, phone: phoneNormalized } });
    if (!contact) {
      contact = await prisma.contact.create({ data: { teamId: team.id, phone: phoneNormalized, name: null } });
    }

    const message = await prisma.message.create({
      data: {
        contactId: contact.id,
        teamId: team.id,
        channel: normalized.channel === 'WHATSAPP' ? 'WHATSAPP' : 'SMS',
        direction: 'INBOUND',
        body: normalized.body ?? null,
        media: normalized.media ?? null,
        externalId: normalized.externalId,
        metadata: { raw: normalized.raw }
      }
    });

    await prisma.event.create({
      data: {
        teamId: team.id,
        type: 'message.inbound',
        payload: { messageId: message.id, externalId: normalized.externalId, from: normalized.from, channel: normalized.channel }
      }
    });

    // TODO: realtime broadcast
    return res.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('/api/webhooks/twilio error', err);
    return res.status(500).json({ error: 'internal_error', detail: String(err) });
  }
});

module.exports = router;
