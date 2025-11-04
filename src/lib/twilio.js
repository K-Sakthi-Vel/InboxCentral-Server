const twilio = require('twilio');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM;

const client = twilio(accountSid, authToken);

// Store OTPs temporarily (in a real application, use a more robust solution like Redis)
const otpStore = new Map(); // Map: userId -> { otp, twilioNumber, expiry }

async function sendWhatsappOtp(userId, twilioNumber) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
  const expiry = Date.now() + 5 * 60 * 1000; // OTP valid for 5 minutes

  otpStore.set(userId, { otp, twilioNumber, expiry });

  try {
    await client.messages.create({
      from: whatsappFrom,
      to: `whatsapp:${twilioNumber}`,
      body: `Your verification code is: ${otp}. It is valid for 5 minutes.`,
    });
    console.log(`OTP sent to ${twilioNumber} for user ${userId}`);
    return true;
  } catch (error) {
    console.error(`Error sending OTP to ${twilioNumber}:`, error);
    return false;
  }
}

async function verifyWhatsappOtp(userId, twilioNumber, userOtp) {
  const storedOtpData = otpStore.get(userId);

  if (!storedOtpData) {
    return { success: false, message: 'No OTP requested for this user.' };
  }

  const { otp, twilioNumber: storedTwilioNumber, expiry } = storedOtpData;

  if (Date.now() > expiry) {
    otpStore.delete(userId); // OTP expired
    return { success: false, message: 'OTP expired.' };
  }

  if (storedTwilioNumber !== twilioNumber) {
    return { success: false, message: 'Twilio number mismatch.' };
  }

  if (otp === userOtp) {
    // Check if the twilioNumber is already associated with another user
    const existingUserWithTwilioNumber = await prisma.user.findFirst({
      where: {
        twilioNumber: twilioNumber,
        NOT: {
          id: userId,
        },
      },
    });

    if (existingUserWithTwilioNumber) {
      return { success: false, message: 'This Twilio number is already linked to another account.' };
    }

    // OTP matched, update user's Twilio verification status
    await prisma.user.update({
      where: { id: userId },
      data: {
        twilioNumber: twilioNumber,
        isTwilioVerified: true,
      },
    });
    otpStore.delete(userId); // Clear OTP after successful verification
    return { success: true, message: 'Twilio number verified successfully.' };
  } else {
    return { success: false, message: 'Invalid OTP.' };
  }
}

module.exports = {
  sendWhatsappOtp,
  verifyWhatsappOtp,
};
