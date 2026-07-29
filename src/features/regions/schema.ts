import { z } from "zod";

export const regionDtoSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  level: z.number().int().min(1).max(3),
  parentId: z.uuid().nullable(),
}).strict();

export const regionDtoListSchema = z.array(regionDtoSchema);

export type RegionDto = z.infer<typeof regionDtoSchema>;
