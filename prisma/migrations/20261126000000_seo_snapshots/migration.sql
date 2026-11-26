-- CreateTable
CREATE TABLE "SeoSnapshot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL,
    "audited" INTEGER NOT NULL,
    "withIssues" INTEGER NOT NULL,
    "missingMetaTitle" INTEGER NOT NULL,
    "missingMetaDescription" INTEGER NOT NULL,
    "missingAlt" INTEGER NOT NULL,
    "duplicateTitles" INTEGER NOT NULL,

    CONSTRAINT "SeoSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeoSnapshot_shop_takenAt_idx" ON "SeoSnapshot"("shop", "takenAt");

