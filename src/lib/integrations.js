// src/lib/integrations.js
const Twilio = require('twilio');
const crypto = require('crypto');

const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
const authToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFromSms = process.env.TWILIO_SMS_FROM || '';
const twilioFromWhatsApp = process.env.TWILIO_WHATSAPP_FROM || '';

let twilioClient = null;
try {
  if (accountSid && authToken) {
    twilioClient = Twilio(accountSid, authToken);
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('Twilio client init failed', e);
}

/**
 * Validate Twilio webhook signature using Twilio's RequestValidator when available.
 * Fallback to HMAC (dev only) if helper missing.
 */
function validateTwilioRequest({ url, headers, form }) {
  const signature = headers['x-twilio-signature'] || headers['X-Twilio-Signature'];
  if (!signature) return false;

  try {
    // Twilio's SDK exposes RequestValidator under Twilio.validateRequest or Twilio.webhook
    // Official way: new Twilio.RequestValidator(authToken).validate(url, params, signature)
    // But in some SDK builds it's available at Twilio.validateRequest; try both.
    if (Twilio && typeof Twilio.RequestValidator === 'function') {
      const RequestValidator = Twilio.RequestValidator;
      const validator = new RequestValidator(authToken);
      // validator.validate expects params as object
      return validator.validate(url, form || {}, signature);
    }
    if (typeof Twilio.validateRequest === 'function') {
      return Twilio.validateRequest(authToken, signature, url, form || {});
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Twilio validator helper failed, falling back to HMAC', e);
  }

  // Fallback (not identical to Twilio algorithm) — fine for local dev only
  try {
    const hmac = crypto.createHmac('sha1', authToken || '');
    hmac.update(JSON.stringify(form || {}));
    const digest = hmac.digest('base64');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch (err) {
    // eslint-disable-next-line no-console
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
async function sendSmsOrWhatsapp({ to, body, media = [], channel = 'SMS' }) {
  console.log(`Attempting to send message: to=${to}, channel=${channel}, body=${body}`);
  if (!twilioClient) throw new Error('Twilio client not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
  const from = channel === 'WHATSAPP' ? twilioFromWhatsApp : twilioFromSms;
  if (!from) throw new Error(`TWILIO_SMS_FROM / TWILIO_WHATSAPP_FROM not set for channel: ${channel}`);

  const toNormalized = channel === 'WHATSAPP' && !String(to).startsWith('whatsapp:') ? `whatsapp:${to}` : to;

  const options = { from, to: toNormalized };
  if (body) options.body = body;
  if (media && media.length) options.mediaUrl = media;

  const msg = await twilioClient.messages.create(options);
  return { provider: 'twilio', externalId: msg.sid, status: msg.status || 'queued', raw: msg };
}

/**
 * createSender factory
 */
function createSender(channel) {
  if (channel === 'SMS' || channel === 'WHATSAPP') {
    return {
      send: async ({ to, body, media }) => {
        if (!to) throw new Error('Destination "to" required');
        return await sendSmsOrWhatsapp({ to, body, media: media || [], channel });
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
