-- Store undirected region adjacency as one canonical ordered pair.
CREATE TABLE "RegionAdjacency" (
    "id" UUID NOT NULL,
    "regionAId" UUID NOT NULL,
    "regionBId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegionAdjacency_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RegionAdjacency_canonical_pair_check" CHECK ("regionAId" < "regionBId")
);

CREATE UNIQUE INDEX "RegionAdjacency_regionAId_regionBId_key"
ON "RegionAdjacency"("regionAId", "regionBId");

CREATE INDEX "RegionAdjacency_regionBId_idx" ON "RegionAdjacency"("regionBId");

ALTER TABLE "RegionAdjacency"
ADD CONSTRAINT "RegionAdjacency_regionAId_fkey"
FOREIGN KEY ("regionAId") REFERENCES "Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RegionAdjacency"
ADD CONSTRAINT "RegionAdjacency_regionBId_fkey"
FOREIGN KEY ("regionBId") REFERENCES "Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;
