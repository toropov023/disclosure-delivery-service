-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "advisorId" TEXT NOT NULL,
    CONSTRAINT "Client_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "Fund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "DisclosureDocument" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "fundId" TEXT NOT NULL,

    PRIMARY KEY ("id", "version"),
    CONSTRAINT "DisclosureDocument_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund" ("id") ON DELETE CASCADE ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "disclosureDocumentId" TEXT NOT NULL,
    "disclosureDocumentVersion" INTEGER NOT NULL,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "firstAttemptAt" DATETIME,
    "sentAt" DATETIME,
    "receivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Delivery_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "Delivery_disclosureDocumentId_disclosureDocumentVersion_fkey" FOREIGN KEY ("disclosureDocumentId", "disclosureDocumentVersion") REFERENCES "DisclosureDocument" ("id", "version") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "DeliveryEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deliveryId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "advisorId" TEXT NOT NULL,
    "advisorName" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "fundName" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "providerMessageId" TEXT,
    "receivedAt" DATETIME,
    "sentAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_providerMessageId_key" ON "Delivery"("providerMessageId");
