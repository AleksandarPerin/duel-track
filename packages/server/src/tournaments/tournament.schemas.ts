import { z } from 'zod';

const TOURNAMENT_FORMATS = [
  'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'draft', 'sealed',
] as const;

const REL_LEVELS = ['regular', 'competitive', 'professional'] as const;

export const CreateTournamentSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  format: z.enum(TOURNAMENT_FORMATS),
  rel_level: z.enum(REL_LEVELS).default('regular'),
  venue: z.string().max(200).trim().optional(),
  scheduled_at: z.string().datetime({ offset: true }).optional(),
  total_rounds: z.number().int().min(3).max(10),
  top_cut: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(8)]).default(8),
}).strict();

export const UpdateTournamentSchema = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  venue: z.string().max(200).trim().optional().nullable(),
  scheduled_at: z.string().datetime({ offset: true }).optional().nullable(),
}).strict().refine(
  (obj) => Object.keys(obj).length > 0,
  { message: 'At least one field must be provided' },
);

export const AddPlayerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('user'),
    user_id: z.string().uuid(),
  }),
  z.object({
    type: z.literal('guest'),
    guest_name: z.string().min(1).max(100).trim().transform((s) => s.normalize('NFC')),
    guest_email: z.string().email().max(255).toLowerCase().optional(),
  }),
]);

export const ReorderSeedsSchema = z.object({
  seeds: z
    .array(
      z.object({
        player_id: z.string().uuid(),
        sort_seed: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(512),
});

export const UUIDParamSchema = z.string().uuid();

export type CreateTournamentInput = z.infer<typeof CreateTournamentSchema>;
export type UpdateTournamentInput = z.infer<typeof UpdateTournamentSchema>;
export type AddPlayerInput = z.infer<typeof AddPlayerSchema>;
export type ReorderSeedsInput = z.infer<typeof ReorderSeedsSchema>;
