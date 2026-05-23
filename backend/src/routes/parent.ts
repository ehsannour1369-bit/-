import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../index';
import { requireRole } from '../middleware/auth';

const isParent = requireRole('parent', 'parent_temp');

export default async function parentRoutes(app: FastifyInstance) {
  app.post('/link-child', { preHandler: [isParent] }, async (request, reply) => {
    const schema = z.object({
      studentMobile: z.string().optional(),
      studentId:     z.string().optional(),
    }).refine(d => d.studentMobile || d.studentId, { message: 'Provide studentMobile or studentId' });

    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const { studentMobile, studentId } = result.data;
    const student = await prisma.user.findFirst({
      where: studentId ? { id: studentId } : { mobile: studentMobile },
    });
    if (!student) return reply.status(404).send({ error: 'Student not found' });

    const link = await prisma.parentStudent.upsert({
      where: { parentId_studentId: { parentId: request.user.userId, studentId: student.id } },
      create: { parentId: request.user.userId, studentId: student.id },
      update: {},
    });

    await prisma.notification.create({
      data: {
        userId: student.id,
        title: 'درخواست اتصال اولیا',
        body: 'یک ولی می‌خواهد به حساب شما متصل شود.',
      },
    });

    reply.status(201).send({ data: link });
  });

  app.get('/children', { preHandler: [isParent] }, async (request, reply) => {
    const links = await prisma.parentStudent.findMany({
      where: { parentId: request.user.userId },
      include: {
        student: {
          select: { id: true, name: true, role: true, gradeLevelId: true, currentSchoolId: true,
                    gradeLevel: true, currentSchool: true },
        },
      },
    });
    reply.send({ data: links });
  });

  app.get('/children/:studentId/report', { preHandler: [isParent] }, async (request, reply) => {
    const { studentId } = request.params as { studentId: string };

    const link = await prisma.parentStudent.findFirst({
      where: { parentId: request.user.userId, studentId },
    });
    if (!link) return reply.status(403).send({ error: 'Not linked to this student' });

    const SEVEN_DAYS_AGO  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000);
    const PREV_WEEK_START = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const PREV_WEEK_END   = SEVEN_DAYS_AGO;

    const [thisWeekProgress, lastWeekProgress, skillScores] = await Promise.all([
      prisma.studentProgress.findMany({
        where: { studentId, completedAt: { gte: SEVEN_DAYS_AGO } },
        include: { lesson: { include: { book: { include: { subject: true } } } } },
      }),
      prisma.studentProgress.findMany({
        where: { studentId, completedAt: { gte: PREV_WEEK_START, lte: PREV_WEEK_END } },
      }),
      prisma.studentSkillScore.findMany({
        where: { studentId, lastUpdated: { gte: PREV_WEEK_START }, totalAttempts: { gte: 3 } },
        include: { skillTag: { include: { subject: true } } },
        orderBy: { avgScore: 'desc' },
      }),
    ]);

    const minutesThisWeek = thisWeekProgress.reduce((sum, p) => sum + (p.videoWatched ? 2 : 0), 0);
    const strengths  = skillScores.filter(s => s.avgScore >= 80).slice(0, 3);
    const weaknesses = skillScores.filter(s => s.avgScore < 60).sort((a, b) => a.avgScore - b.avgScore).slice(0, 3);

    const subjectMap: Record<string, { thisWeek: number; lastWeek: number }> = {};
    thisWeekProgress.forEach(p => {
      const subj = p.lesson.book.subject.name;
      if (!subjectMap[subj]) subjectMap[subj] = { thisWeek: 0, lastWeek: 0 };
      subjectMap[subj].thisWeek++;
    });

    const progressBySubject = Object.entries(subjectMap).map(([name, counts]) => ({
      subject:   name,
      direction: counts.thisWeek > (counts.lastWeek || 0) ? 'up'
               : counts.thisWeek < (counts.lastWeek || 0) ? 'down'
               : 'same',
    }));

    reply.send({ data: {
      lessonsCompletedThisWeek: thisWeekProgress.length,
      minutesThisWeek,
      strengths:  strengths.map(s => ({ name: s.skillTag.name, subject: s.skillTag.subject.name, score: Math.round(s.avgScore) })),
      weaknesses: weaknesses.map(s => ({ name: s.skillTag.name, subject: s.skillTag.subject.name, score: Math.round(s.avgScore) })),
      progressBySubject,
    }});
  });

  app.patch('/children/:studentId/grade', { preHandler: [isParent] }, async (request, reply) => {
    const { studentId } = request.params as { studentId: string };
    const schema = z.object({ gradeLevelId: z.string() });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student || student.currentSchoolId) {
      return reply.status(400).send({ error: 'Cannot set grade — student is enrolled in a school' });
    }

    const updated = await prisma.user.update({
      where: { id: studentId },
      data: { gradeLevelId: result.data.gradeLevelId },
      select: { id: true, name: true, gradeLevelId: true },
    });
    reply.send({ data: updated });
  });
}
