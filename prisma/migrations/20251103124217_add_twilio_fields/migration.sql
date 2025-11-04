/*
  Warnings:

  - A unique constraint covering the columns `[twilioNumber]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isTwilioVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twilioNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_twilioNumber_key" ON "User"("twilioNumber");
