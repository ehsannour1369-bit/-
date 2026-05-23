import { FastifyInstance } from 'fastify';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';

export default async function sharedRoutes(app: FastifyInstance) {
  app.get('/avatars', { preHandler: [authenticate] }, async (_req, reply) => {
    const avatars = await prisma.avatar.findMany();
    reply.send({ data: avatars });
  });

  app.get('/gadgets', { preHandler: [authenticate] }, async (request, reply) => {
    const gadgets = await prisma.avatarGadget.findMany();
    const owned = request.user?.userId
      ? await prisma.studentAvatarGadget.findMany({ where: { studentId: request.user.userId } })
      : [];
    const ownedIds = new Set(owned.map(o => o.gadgetId));
    reply.send({ data: gadgets.map(g => ({ ...g, owned: ownedIds.has(g.id) })) });
  });

  app.get('/notifications', { preHandler: [authenticate] }, async (request, reply) => {
    const notes = await prisma.notification.findMany({
      where: { userId: request.user.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    reply.send({ data: notes });
  });
}
