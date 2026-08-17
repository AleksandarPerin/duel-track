import { z } from 'zod';

// Body for POST /api/public/register/:token. An authenticated caller needs no
// body fields at all (their identity comes from the session); an anonymous
// caller must supply guest_name. The route handler decides which applies
// based on whether optionalAuthenticate populated request.user, so both
// shapes have to validate — the route rejects a guest submission missing
// guest_name itself rather than via a discriminated union, since the schema
// alone can't see request.user.
export const SubmitRegistrationSchema = z.object({
  guest_name: z
    .string()
    .min(1)
    .max(100)
    .trim()
    .transform((s) => s.normalize('NFC'))
    .optional(),
  guest_email: z.string().email().max(255).toLowerCase().optional(),
}).strict();

export const DecideRegistrationSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
}).strict();

export type SubmitRegistrationInput = z.infer<typeof SubmitRegistrationSchema>;
export type DecideRegistrationInput = z.infer<typeof DecideRegistrationSchema>;
