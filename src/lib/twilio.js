const twilio = require('twilio');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function sendWhatsappOtp(userId, twilioNumber, userTwilioDetails) {
  const { twilioAccountSid, twilioAuthToken, twilioWhatsappFrom } = userTwilioDetails;

  if (!twilioAccountSid || !twilioAuthToken || !twilioWhatsappFrom) {
    console.error('Missing Twilio credentials for user:', userId);
    return false;
  }

  const client = twilio(twilioAccountSid, twilioAuthToken);

  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
  const expiry = new Date(Date.now() + 5 * 60 * 1000); // OTP valid for 5 minutes

  try {
    // Store OTP in the database
    await prisma.twilioOtp.upsert({
      where: { userId: userId },
      update: {
        otp: otp,
        twilioNumber: twilioNumber,
        expiry: expiry,
      },
      create: {
        userId: userId,
        otp: otp,
        twilioNumber: twilioNumber,
        expiry: expiry,
      },
    });

    await client.messages.create({
      from: `whatsapp:${twilioWhatsappFrom}`,
      to: `whatsapp:${twilioNumber}`,
      body: `Your verification code is: ${otp}. It is valid for 5 minutes.`,
    });
    console.log(`OTP sent to ${twilioNumber} for user ${userId}`);
    return true;
  } catch (error) {
    console.error(`Error sending OTP to ${twilioNumber} for user ${userId}:`, error);
    return false;
  }
}

async function verifyWhatsappOtp(userId, twilioNumber, userOtp, userTwilioDetails, twilioAccountSid, twilioAuthToken, twilioSmsFrom, twilioWhatsappFrom) {
  const { twilioAccountSid: currentAccountSid, twilioAuthToken: currentAuthToken } = userTwilioDetails;

  if (!currentAccountSid || !currentAuthToken) {
    console.error('Missing Twilio credentials for user:', userId);
    return { success: false, message: 'Missing Twilio credentials.' };
  }

  const storedOtpData = await prisma.twilioOtp.findUnique({
    where: { userId: userId },
  });

  if (!storedOtpData) {
    return { success: false, message: 'No OTP requested for this user.' };
  }

  const { otp, twilioNumber: storedTwilioNumber, expiry } = storedOtpData;

  if (new Date() > expiry) {
    await prisma.twilioOtp.delete({ where: { userId: userId } }); // OTP expired
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

    // OTP matched, update user's Twilio verification status and credentials
    await prisma.user.update({
      where: { id: userId },
      data: {
        twilioNumber: twilioNumber,
        isTwilioVerified: true,
        twilioAccountSid: twilioAccountSid || currentAccountSid,
        twilioAuthToken: twilioAuthToken || currentAuthToken,
        twilioSmsFrom: twilioSmsFrom,
        twilioWhatsappFrom: twilioWhatsappFrom,
      },
    });
    await prisma.twilioOtp.delete({ where: { userId: userId } }); // Clear OTP after successful verification
    return { success: true, message: 'Twilio number verified successfully.' };
  } else {
    return { success: false, message: 'Invalid OTP.' };
  }
}

module.exports = {
  sendWhatsappOtp,
  verifyWhatsappOtp,
};
