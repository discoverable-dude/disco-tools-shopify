-- CreateTable
CREATE TABLE "SalesSummary" (
    "shop" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" TEXT NOT NULL,

    CONSTRAINT "SalesSummary_pkey" PRIMARY KEY ("shop")
);

