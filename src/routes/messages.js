// src/routes/messages.js
const express = require('express');
const { prisma } = require('../lib/db');
const { createSender } = require('../lib/integrations');

const router = express.Router();

/**
 * POST /api/messages/send
 * body: { threadId?, contactId?, body, scheduleAt?, channel? }
 */
router.post('/send', async (req, res) => {
  try {
    const { body: bodyText, channel = 'SMS', contactId, threadId, scheduleAt } = req.body;
    const targetContactId = contactId || threadId;
    if (!bodyText || !targetContactId) return res.status(400).json({ error: 'body and contactId required' });

    const defaultTeamName = process.env.DEFAULT_TEAM_NAME || 'Demo Team';
    let team = await prisma.team.findFirst({ where: { name: defaultTeamName } });
    if (!team) team = await prisma.team.create({ data: { name: defaultTeamName } });

    const contact = await prisma.contact.findUnique({ where: { id: targetContactId } });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const msg = await prisma.message.create({
      data: {
        contactId: contact.id,
        teamId: team.id,
        channel,
        direction: 'OUTBOUND',
        body: bodyText,
        status: 'PENDING',
        scheduledAt: scheduleAt ? new Date(scheduleAt) : null,
        createdById: null
      }
    });

    if (scheduleAt) {
      await prisma.scheduledJob.create({
        data: {
          teamId: team.id,
          messageId: msg.id,
          payload: { body: bodyText, channel, contactId: contact.id },
          scheduledAt: new Date(scheduleAt)
        }
      });
      return res.json({ ok: true, scheduled: true, messageId: msg.id });
    }

    // Immediate send (sync)
    try {
      const sender = createSender(channel);
      const sendResp = await sender.send({ to: contact.phone || contact.email || '', body: bodyText, media: [] });

      await prisma.message.update({
        where: { id: msg.id },
        data: { externalId: sendResp.externalId, status: sendResp.status === 'queued' ? 'PENDING' : 'SENT', sentAt: new Date() }
      });

      await prisma.event.create({
        data: { teamId: team.id, type: 'message.outbound.sent', payload: { messageId: msg.id, externalId: sendResp.externalId } }
      });

      // TODO: realtime broadcast
      return res.json({ ok: true, messageId: msg.id, providerResp: sendResp });
    } catch (errSend) {
      // eslint-disable-next-line no-console
      console.error('send failed', errSend);
      await prisma.message.update({ where: { id: msg.id }, data: { status: 'FAILED' } });
      return res.status(500).json({ ok: false, error: String(errSend?.message || errSend) });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('/api/messages/send error', err);
    return res.status(500).json({ error: 'internal_error', detail: String(err) });
  }
});

/**
 * GET /api/messages/thread/:id
 */
router.get('/thread/:id', async (req, res) => {
  try {
    const contactId = req.params.id;
    if (!contactId) return res.status(400).json({ error: 'Missing id' });

    const msgs = await prisma.message.findMany({ where: { contactId }, orderBy: { createdAt: 'asc' }, take: 200 });

    const out = msgs.map((m) => ({ id: m.id, contactId: m.contactId, direction: m.direction, body: m.body, media: m.media || null, createdAt: m.createdAt.toISOString() }));
    return res.json(out);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('/api/messages/thread/:id error', err);
    return res.status(500).json({ error: 'internal_error', detail: String(err) });
  }
});

module.exports = router;
