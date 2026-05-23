import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../index';
import { requireRole } from '../middleware/auth';

const isSchool = requireRole('school');

export default async function schoolRoutes(app: FastifyInstance) {
  // ── Classes ───────────────────────────────────────────────────────────────
  app.get('/classes', { preHandler: [isSchool] }, async (request, reply) => {
    const school = await prisma.school.findFirst({ where: { ownerId: request.user.userId } });
    if (!school) return reply.status(404).send({ error: 'School not found' });

    const classes = await prisma.class.findMany({
      where: { branch: { schoolId: school.id } },
      include: {
        gradeLevel: true,
        branch: true,
        _count: { select: { students: true, teachers: true } },
      },
    });
    reply.send({ data: classes });
  });

  app.post('/classes', { preHandler: [isSchool] }, async (request, reply) => {
    const schema = z.object({
      branchId:     z.string(),
      gradeLevelId: z.string(),
      name:         z.string(),
      academicYear: z.string().optional(),
    });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const cls = await prisma.class.create({ data: result.data });
    reply.status(201).send({ data: cls });
  });

  // ── Teacher assignment ────────────────────────────────────────────────────
  app.post('/classes/:classId/teachers', { preHandler: [isSchool] }, async (request, reply) => {
    const { classId } = request.params as { classId: string };
    const schema = z.object({ bookId: z.string(), teacherId: z.string() });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const assignment = await prisma.classBookTeacher.create({
      data: { classId, bookId: result.data.bookId, teacherId: result.data.teacherId },
    });
    reply.status(201).send({ data: assignment });
  });

  // ── Student enrollment ────────────────────────────────────────────────────
  app.post('/classes/:classId/students', { preHandler: [isSchool] }, async (request, reply) => {
    const { classId } = request.params as { classId: string };
    const schema = z.object({ studentId: z.string(), bookId: z.string() });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const { studentId, bookId } = result.data;
    const school = await prisma.school.findFirst({ where: { ownerId: request.user.userId } });
    if (!school) return reply.status(404).send({ error: 'School not found' });

    const grant = await prisma.bookGrant.findFirst({ where: { bookId, grantedToId: school.id } });
    if (!grant) return reply.status(400).send({ error: 'No book grant for this book' });

    const usedSeats = await prisma.classStudent.count({
      where: { bookId, class: { branch: { schoolId: school.id } } },
    });
    if (usedSeats >= grant.quantity) {
      return reply.status(400).send({ error: 'Insufficient book grants. Contact admin for more.' });
    }

    const enrollment = await prisma.classStudent.create({
      data: { classId, bookId, studentId },
    });

    const currentYear = '1403-04';
    await prisma.studentSchoolHistory.upsert({
      where: { studentId_schoolId_academicYear: { studentId, schoolId: school.id, academicYear: currentYear } },
      create: { studentId, schoolId: school.id, academicYear: currentYear },
      update: {},
    });

    reply.status(201).send({ data: enrollment });
  });

  app.delete('/classes/:classId/students/:studentId', { preHandler: [isSchool] }, async (request, reply) => {
    const { classId, studentId } = request.params as { classId: string; studentId: string };
    const { bookId } = request.query as { bookId: string };
    await prisma.classStudent.deleteMany({ where: { classId, studentId, bookId } });
    reply.send({ data: { success: true } });
  });

  // ── Grant summary ─────────────────────────────────────────────────────────
  app.get('/grants', { preHandler: [isSchool] }, async (request, reply) => {
    const school = await prisma.school.findFirst({ where: { ownerId: request.user.userId } });
    if (!school) return reply.status(404).send({ error: 'School not found' });

    const grants = await prisma.bookGrant.findMany({
      where: { grantedToId: school.id },
      include: { book: { include: { subject: { include: { gradeLevel: true } } } } },
    });

    const result = await Promise.all(grants.map(async (g) => {
      const used = await prisma.classStudent.count({
        where: { bookId: g.bookId, class: { branch: { schoolId: school.id } } },
      });
      return { ...g, used, remaining: g.quantity - used };
    }));

    reply.send({ data: result });
  });

  // ── Reports ───────────────────────────────────────────────────────────────
  app.get('/reports/overview', { preHandler: [isSchool] }, async (request, reply) => {
    const school = await prisma.school.findFirst({ where: { ownerId: request.user.userId } });
    if (!school) return reply.status(404).send({ error: 'School not found' });

    const classes = await prisma.class.findMany({
      where: { branch: { schoolId: school.id } },
      include: { students: { include: { student: { include: { progress: true } } } } },
    });

    const classReports = classes.map(cls => {
      const totalStudents = cls.students.length;
      const activeStudents = cls.students.filter(cs =>
        cs.student.progress.some(p => p.videoWatched)
      ).length;
      const completionRate = totalStudents > 0 ? Math.round((activeStudents / totalStudents) * 100) : 0;
      return { classId: cls.id, className: cls.name, totalStudents, completionRate };
    });

    reply.send({ data: classReports });
  });
}
