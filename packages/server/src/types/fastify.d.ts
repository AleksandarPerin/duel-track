import type { UserRole } from '@dueltrack/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      role: UserRole;
      tokenVersion: number;
    };
  }
}
