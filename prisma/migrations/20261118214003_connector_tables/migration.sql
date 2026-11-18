-- CreateTable
CREATE TABLE "ShopLink" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "clientSlug" TEXT,
    "platformClientId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'installed',
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedAt" DATETIME,
    "uninstalledAt" DATETIME,
    "lastSyncAt" DATETIME,
    "lastSyncStatus" TEXT
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "webhookId" TEXT,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "bulkOpId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "PushAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "changes" TEXT NOT NULL,
    "previous" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "WebhookEvent_shop_receivedAt_idx" ON "WebhookEvent"("shop", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");

-- CreateIndex
CREATE INDEX "SyncRun_shop_startedAt_idx" ON "SyncRun"("shop", "startedAt");

-- CreateIndex
CREATE INDEX "SyncRun_bulkOpId_idx" ON "SyncRun"("bulkOpId");

-- CreateIndex
CREATE INDEX "PushAudit_shop_createdAt_idx" ON "PushAudit"("shop", "createdAt");
