// src/workers/scheduler.js
const { prisma } = require('../lib/db');
const { createSender } = require('../lib/integrations');

const POLL_MS = Number(process.env.SCHEDULER_POLL_MS || 5000);

async function processJob(jobId) {
  const job = await prisma.scheduledJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  try {
    const payload = job.payload || {};
    const contactId = payload.contactId;
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) throw new Error('Contact not found');

    const channel = payload.channel || 'SMS';
    const sender = createSender(channel);

    const to = contact.phone || contact.email;
    if (!to) throw new Error('Contact has no destination');

    const resp = await sender.send({ to, body: payload.body, media: payload.media || [] });

    if (job.messageId) {
      await prisma.message.update({ where: { id: job.messageId }, data: { status: resp.status === 'queued' ? 'PENDING' : 'SENT', sentAt: new Date(), externalId: resp.externalId } });
    }

    await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', attempts: job.attempts + 1 } });
    await prisma.event.create({ data: { teamId: job.teamId, type: 'scheduled.sent', payload: { scheduledJobId: job.id, externalId: resp.externalId } } });

    console.log(`[scheduler] job ${job.id} sent -> ${resp.externalId}`);
  } catch (err) {
    console.error('[scheduler] job failed', jobId, err);
    await prisma.scheduledJob.update({ where: { id: jobId }, data: { attempts: job.attempts + 1, status: 'FAILED' } });
  }
}

async function pollLoop() {
  console.log('[scheduler] poll loop start, interval ms=', POLL_MS);
  while (true) {
    try {
      const now = new Date();
      const jobs = await prisma.scheduledJob.findMany({ where: { scheduledAt: { lte: now }, status: 'PENDING' }, orderBy: { scheduledAt: 'asc' }, take: 5 });

      for (const j of jobs) {
        await prisma.scheduledJob.update({ where: { id: j.id }, data: { status: 'RUNNING' } });
        await processJob(j.id);
      }
    } catch (err) {
      console.error('[scheduler] poll error', err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (require.main === module) {
  // run only when executed directly
  pollLoop().catch((err) => {
    console.error('[scheduler] fatal', err);
    process.exit(1);
  });
}

module.exports = { pollLoop };
