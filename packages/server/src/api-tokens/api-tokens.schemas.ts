import { z } from 'zod';

export const CreateApiTokenSchema = z.object({
  label: z.string().trim().min(1).max(100),
});
export type CreateApiTokenInput = z.infer<typeof CreateApiTokenSchema>;
