import { z } from 'zod';

export const AssignJudgeSchema = z.object({
  user_id: z.string().uuid(),
}).strict();

export type AssignJudgeInput = z.infer<typeof AssignJudgeSchema>;
