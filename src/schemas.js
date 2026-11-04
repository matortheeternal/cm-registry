import { z } from 'zod';
import { MAX_PACKAGE, idSchema, typeSchema } from './package.js';

export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const notesSchema = z.object({ notes: z.string().max(4000).default('') }).strict();
export const applicationSchema = z
    .object({
        publicKey: z.string().max(100),
        displayName: z.string().trim().min(1).max(120),
        email: z.email().max(254).optional(),
        description: z.string().trim().min(1).max(2000)
    })
    .strict();
export const slotSchema = z
    .object({
        extensionId: idSchema,
        type: typeSchema,
        version: z.string().max(80),
        sha256: hashSchema,
        size: z.number().int().positive().max(MAX_PACKAGE)
    })
    .strict();
