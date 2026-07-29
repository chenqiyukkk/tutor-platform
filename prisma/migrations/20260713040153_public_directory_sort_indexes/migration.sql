-- CreateIndex
CREATE INDEX "TeacherProfile_status_publishedAt_id_idx" ON "TeacherProfile"("status", "publishedAt" DESC, "id");

-- CreateIndex
CREATE INDEX "TutoringRequest_status_publishedAt_id_idx" ON "TutoringRequest"("status", "publishedAt" DESC, "id");
