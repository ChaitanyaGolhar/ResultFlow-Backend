import { z } from 'zod';

export const UpdateTemplateSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required").max(200).optional(),
    description: z.string().max(1000).optional(),
  })
});

const TemplateFieldSchema = z.object({
  fieldKey: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  fontSize: z.number().int().min(6).max(72).default(12),
  fontFamily: z.enum(['Helvetica', 'Times-Roman', 'Courier']).default('Helvetica'),
  fontColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#000000'),
  align: z.enum(['LEFT', 'CENTER', 'RIGHT']).default('LEFT'),
  isBold: z.boolean().default(false),
  isItalic: z.boolean().default(false),
});

export const UpdateTemplateFieldsSchema = z.object({
  body: z.object({
    fields: z.array(TemplateFieldSchema)
  })
});
