import { z } from 'zod';

const COMMON_WEAK_PASSWORDS = new Set([
  'password', 'password1', '12345678', '123456789', 'qwerty123',
  'iloveyou', 'admin123', 'letmein1', 'welcome1', 'monkey123',
  'sunshine', 'princess', 'football', 'baseball', 'abc12345',
]);

export const RegisterSchema = z.object({
  email: z.string().email().max(255).toLowerCase(),
  display_name: z
    .string()
    .min(1)
    .max(100)
    .trim()
    .transform((s) => s.normalize('NFC')),
  password: z
    .string()
    .min(8)
    .max(128)
    .refine(
      (p) => !COMMON_WEAK_PASSWORDS.has(p.toLowerCase()),
      'Password is too common',
    ),
});

export const LoginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(128),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
