-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twilioAccountSid" TEXT,
ADD COLUMN     "twilioAuthToken" TEXT,
ADD COLUMN     "twilioSmsFrom" TEXT,
ADD COLUMN     "twilioWhatsappFrom" TEXT;
