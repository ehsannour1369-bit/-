import { FastifyRequest, FastifyReply } from 'fastify';
import { Role } from '@prisma/client';

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized — invalid or missing token' });
  }
}

export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await authenticate(request, reply);
    const user = request.user as JwtPayload;
    if (!roles.includes(user.role)) {
      reply.status(403).send({ error: 'Forbidden — insufficient permissions' });
    }
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload;
  }
}
