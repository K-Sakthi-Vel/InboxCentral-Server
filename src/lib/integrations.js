// src/lib/integrations.js
const Twilio = require('twilio');
const crypto = require('crypto');
const { prisma } = require('./db'); // Import prisma

// Twilio client will be initialized dynamically per user
let twilioClientCache = {};

async function getTwilioClient(userId) {
  if (twilioClientCache[userId]) {
    return twilioClientCache[userId];
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      twilioAccountSid: true,
      twilioAuthToken: true,
      twilioSmsFrom: true,
      twilioWhatsappFrom: true,
    },
  });

  if (!user || !user.twilioAccountSid || !user.twilioAuthToken) {
    throw new Error('Twilio credentials not configured for this user.');
  }

  const client = Twilio(user.twilioAccountSid, user.twilioAuthToken);
  twilioClientCache[userId] = {
    client,
    smsFrom: user.twilioSmsFrom,
    whatsappFrom: user.twilioWhatsappFrom,
  };
  console.log(`Twilio details fetched for user ${userId}:`);
  console.log(`  Account SID: ${user.twilioAccountSid ? '********' + user.twilioAccountSid.slice(-4) : 'N/A'}`);
  console.log(`  Auth Token: ${user.twilioAuthToken ? '********' + user.twilioAuthToken.slice(-4) : 'N/A'}`);
  console.log(`  SMS From: ${user.twilioSmsFrom || 'N/A'}`);
  console.log(`  WhatsApp From: ${user.twilioWhatsappFrom || 'N/A'}`);
  return twilioClientCache[userId];
}

/**
 * Validate Twilio webhook signature using Twilio's RequestValidator when available.
 * Fallback to HMAC (dev only) if helper missing.
 */
async function validateTwilioRequest({ url, headers, form, userId }) {
  const signature = headers['x-twilio-signature'] || headers['X-Twilio-Signature'];
  if (!signature) return false;

  try {
    const { client } = await getTwilioClient(userId);
    const authToken = client.authToken;

    if (Twilio && typeof Twilio.RequestValidator === 'function') {
      const RequestValidator = Twilio.RequestValidator;
      const validator = new RequestValidator(authToken);
      return validator.validate(url, form || {}, signature);
    }
    if (typeof Twilio.validateRequest === 'function') {
      return Twilio.validateRequest(authToken, signature, url, form || {});
    }
  } catch (e) {
    console.warn('Twilio validator helper failed, falling back to HMAC', e);
  }

  try {
    const { client } = await getTwilioClient(userId);
    const authToken = client.authToken;
    const hmac = crypto.createHmac('sha1', authToken || '');
    hmac.update(JSON.stringify(form || {}));
    const digest = hmac.digest('base64');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch (err) {
    console.error('Twilio signature fallback error', err);
    return false;
  }
}

/**
 * Parse Twilio inbound webhook into normalized object
 */
function parseTwilioWebhook(raw) {
  const messageSid = raw.MessageSid || raw.SmsMessageSid || raw.SmsSid || `${raw.From}-${Date.now()}`;
  const from = raw.From || raw.from || '';
  const to = raw.To || raw.to || '';
  const body = raw.Body || raw.body || null;
  const numMedia = Number(raw.NumMedia || raw.num_media || 0);

  const media = [];
  for (let i = 0; i < numMedia; i += 1) {
    const k = `MediaUrl${i}`;
    if (raw[k]) media.push(raw[k]);
  }

  const channel = String(from).startsWith('whatsapp:') ? 'WHATSAPP' : 'SMS';

  return {
    externalId: String(messageSid),
    channel,
    from: String(from),
    to: String(to),
    body,
    media: media.length ? media : null,
    timestamp: raw.Timestamp || raw.timestamp || new Date().toISOString(),
    raw
  };
}

/**
 * Send via Twilio (SMS or WhatsApp)
 */
async function sendSmsOrWhatsapp({ to, body, media = [], channel = 'SMS', userId }) {
  console.log(`Attempting to send message: to=${to}, channel=${channel}, body=${body}, userId=${userId}`);
  const { client, smsFrom, whatsappFrom } = await getTwilioClient(userId);

  let from = channel === 'WHATSAPP' ? whatsappFrom : smsFrom;
  if (!from) throw new Error(`Twilio "From" number not set for channel: ${channel} for team: ${teamId}`);

  // Ensure 'from' number is correctly formatted for WhatsApp
  if (channel === 'WHATSAPP' && !String(from).startsWith('whatsapp:')) {
    from = `whatsapp:${from}`;
  }

  const toNormalized = channel === 'WHATSAPP' && !String(to).startsWith('whatsapp:') ? `whatsapp:${to}` : to;

  const options = { from, to: toNormalized };
  if (body) options.body = body;
  if (media && media.length) options.mediaUrl = media;

  const msg = await client.messages.create(options);
  return { provider: 'twilio', externalId: msg.sid, status: msg.status || 'queued', raw: msg };
}

/**
 * createSender factory
 */
function createSender(channel, userId) {
  if (channel === 'SMS' || channel === 'WHATSAPP') {
    return {
      send: async ({ to, body, media }) => {
        if (!to) throw new Error('Destination "to" required');
        return await sendSmsOrWhatsapp({ to, body, media: media || [], channel, userId });
      }
    };
  }

  throw new Error(`createSender: unsupported channel ${channel}`);
}

module.exports = {
  validateTwilioRequest,
  parseTwilioWebhook,
  createSender
};
