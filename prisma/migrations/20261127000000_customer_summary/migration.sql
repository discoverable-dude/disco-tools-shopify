-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN     "variant" TEXT;

-- CreateTable
CREATE TABLE "CustomerSummary" (
    "shop" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" TEXT NOT NULL,

    CONSTRAINT "CustomerSummary_pkey" PRIMARY KEY ("shop")
);

