// src/routes/inbox.js
const express = require('express');
const { prisma } = require('../lib/db');

const router = express.Router();

/**
 * GET /api/inbox/threads
 */
router.get('/threads', async (req, res) => {
  try {
    const defaultTeamName = process.env.DEFAULT_TEAM_NAME || 'Demo Team';
    let team = await prisma.team.findFirst({ where: { name: defaultTeamName } });
    if (!team) team = await prisma.team.create({ data: { name: defaultTeamName } });

    const contacts = await prisma.contact.findMany({
      where: { teamId: team.id },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: 200
    });

    const threads = contacts.map((c) => {
      const last = c.messages[0];
      return { id: c.id, contactName: c.name || c.phone || c.email || 'Unknown', snippet: last ? last.body : null, unread: 0, channel: last ? last.channel : 'SMS', updatedAt: last ? last.createdAt : c.createdAt };
    });

    return res.json(threads);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('/api/inbox/threads error', err);
    return res.status(500).json({ error: 'internal_error', detail: String(err) });
  }
});

module.exports = router;
