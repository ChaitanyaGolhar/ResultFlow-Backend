import { z } from 'zod';

export const ValidateDataSchema = z.object({
  body: z.object({
    uploadId: z.string().min(1, "uploadId is required"),
    templateId: z.string().min(1, "templateId is required"),
    columnMapping: z.record(z.string(), z.string()).refine(map => Object.keys(map).length > 0, "columnMapping cannot be empty")
  })
});
