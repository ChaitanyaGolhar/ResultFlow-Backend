import { z } from 'zod';

export const CreateJobSchema = z.object({
  body: z.object({
    templateId: z.string().min(1, "templateId is required"),
    uploadId: z.string().min(1, "uploadId is required"),
    columnMapping: z.record(z.string(), z.string()).refine(map => Object.keys(map).length > 0, "columnMapping cannot be empty")
  })
});
