import { z } from 'zod';

// The claim takes no input at all — the caller's identity comes from the
// session and the target from the URL. .strict() is load-bearing rather than
// decorative: it rejects a caller trying to smuggle in an `email` or `user_id`
// field, which is precisely the parameter this route must never honour.
export const ClaimPlayerSchema = z.object({}).strict();

export const LinkPlayerSchema = z.object({
  user_id: z.string().uuid(),
}).strict();

export type ClaimPlayerInput = z.infer<typeof ClaimPlayerSchema>;
export type LinkPlayerInput = z.infer<typeof LinkPlayerSchema>;
