-- CreateIndex
CREATE INDEX "Favorite_ownerAccountId_createdAt_id_idx" ON "Favorite"("ownerAccountId", "createdAt" DESC, "id");
