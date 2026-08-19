import { z } from 'zod';

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_QUERY_LEN = 100;

const TournamentFormatEnum = z.enum([
  'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'draft', 'sealed',
]);

export const SearchArchiveQuerySchema = z.object({
  q: z.string().trim().min(1).max(MAX_QUERY_LEN).optional(),
  format: TournamentFormatEnum.optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
}).strict().refine(
  (v) => !v.date_from || !v.date_to || v.date_from <= v.date_to,
  { message: 'date_from must be before date_to', path: ['date_from'] },
);

export type SearchArchiveQuery = z.infer<typeof SearchArchiveQuerySchema>;
