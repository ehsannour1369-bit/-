import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../index';
import { requireRole } from '../middleware/auth';

const isAdmin = requireRole('admin');

export default async function adminRoutes(app: FastifyInstance) {
  // ── Users ───────────────────────────────────────────────────────────────
  app.get('/users', { preHandler: [isAdmin] }, async (request, reply) => {
    const { role, status, page = '1', limit = '20' } = request.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (role)   where.role   = role;
    if (status) where.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take: parseInt(limit),
        select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);
    reply.send({ data: { users, total, page: parseInt(page), limit: parseInt(limit) } });
  });

  app.patch('/users/:id', { preHandler: [isAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({
      role:   z.enum(['admin', 'school', 'school_temp', 'teacher', 'teacher_temp',
                      'parent', 'parent_temp', 'student', 'student_temp']).optional(),
      status: z.enum(['active', 'suspended']).optional(),
    });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const user = await prisma.user.update({
      where: { id }, data: result.data,
      select: { id: true, email: true, role: true, status: true },
    });
    reply.send({ data: user });
  });

  // ── Grade Levels ─────────────────────────────────────────────────────────
  app.get('/grade-levels', { preHandler: [isAdmin] }, async (_req, reply) => {
    const grades = await prisma.gradeLevel.findMany({ orderBy: { level: 'asc' } });
    reply.send({ data: grades });
  });

  app.post('/grade-levels', { preHandler: [isAdmin] }, async (request, reply) => {
    const schema = z.object({ level: z.number().int().min(1).max(12), stage: z.string() });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const grade = await prisma.gradeLevel.create({ data: result.data });
    reply.status(201).send({ data: grade });
  });

  // ── Subjects ─────────────────────────────────────────────────────────────
  app.post('/subjects', { preHandler: [isAdmin] }, async (request, reply) => {
    const schema = z.object({ name: z.string(), gradeLevelId: z.string() });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const subject = await prisma.subject.create({ data: result.data });
    reply.status(201).send({ data: subject });
  });

  // ── Books ─────────────────────────────────────────────────────────────────
  app.get('/books', { preHandler: [isAdmin] }, async (_req, reply) => {
    const books = await prisma.book.findMany({
      include: { subject: { include: { gradeLevel: true } } },
      orderBy: { subject: { gradeLevel: { level: 'asc' } } },
    });
    reply.send({ data: books });
  });

  app.post('/books', { preHandler: [isAdmin] }, async (request, reply) => {
    const schema = z.object({ title: z.string(), subjectId: z.string(), price: z.number().optional() });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const book = await prisma.book.create({ data: result.data });
    reply.status(201).send({ data: book });
  });

  // ── Lessons ───────────────────────────────────────────────────────────────
  app.get('/lessons', { preHandler: [isAdmin] }, async (request, reply) => {
    const { bookId } = request.query as { bookId?: string };
    const lessons = await prisma.lesson.findMany({
      where: bookId ? { bookId } : {},
      include: {
        videos: { select: { id: true, hlsUrl: true } },
        games:  { select: { id: true, approvalStatus: true } },
      },
      orderBy: [{ chapterNo: 'asc' }, { lessonNo: 'asc' }],
    });
    reply.send({ data: lessons });
  });

  app.post('/lessons', { preHandler: [isAdmin] }, async (request, reply) => {
    const schema = z.object({
      bookId:               z.string(),
      chapterNo:            z.number().int(),
      lessonNo:             z.number().int(),
      title:                z.string(),
      okiddChartUnlockWeek: z.number().int().optional(),
    });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const lesson = await prisma.lesson.create({ data: result.data });
    reply.status(201).send({ data: lesson });
  });

  app.patch('/lessons/:id', { preHandler: [isAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({
      title:                  z.string().optional(),
      schoolProgressUnlocked: z.boolean().optional(),
      okiddChartUnlockWeek:   z.number().int().optional(),
    });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const lesson = await prisma.lesson.update({ where: { id }, data: result.data });
    reply.send({ data: lesson });
  });

  // ── Content: Video + Game upload ─────────────────────────────────────────
  app.post('/lessons/:id/video', { preHandler: [isAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({ hlsUrl: z.string().url(), durationSec: z.number().int().optional() });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const video = await prisma.contentVideo.create({
      data: { lessonId: id, uploadedBy: request.user.userId, ...result.data },
    });
    reply.status(201).send({ data: video });
  });

  app.post('/lessons/:id/game', { preHandler: [isAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({ htmlFileUrl: z.string().url() });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const game = await prisma.game.create({
      data: {
        lessonId: id, uploadedBy: request.user.userId,
        approvalStatus: 'approved', scope: 'admin', ...result.data,
      },
    });
    reply.status(201).send({ data: game });
  });

  // ── Book Grants ───────────────────────────────────────────────────────────
  app.post('/grants', { preHandler: [isAdmin] }, async (request, reply) => {
    const schema = z.object({
      bookId:      z.string(),
      grantedToId: z.string(),
      quantity:    z.number().int().min(1),
    });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const grant = await prisma.bookGrant.create({
      data: { ...result.data, grantedById: request.user.userId },
    });
    reply.status(201).send({ data: grant });
  });

  app.get('/grants', { preHandler: [isAdmin] }, async (request, reply) => {
    const { bookId, grantedToId } = request.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (bookId)      where.bookId      = bookId;
    if (grantedToId) where.grantedToId = grantedToId;

    const grants = await prisma.bookGrant.findMany({
      where,
      include: { book: true },
      orderBy: { grantedAt: 'desc' },
    });
    reply.send({ data: grants });
  });

  // ── Reports ───────────────────────────────────────────────────────────────
  app.get('/reports/overview', { preHandler: [isAdmin] }, async (_req, reply) => {
    const [totalUsers, totalSchools, totalLessons, totalStudents] = await Promise.all([
      prisma.user.count(),
      prisma.school.count(),
      prisma.lesson.count(),
      prisma.user.count({ where: { role: 'student' } }),
    ]);
    reply.send({ data: { totalUsers, totalSchools, totalLessons, totalStudents } });
  });
}
