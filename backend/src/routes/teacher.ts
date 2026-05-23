import { FastifyInstance } from 'fastify';
import { prisma } from '../index';
import { requireRole } from '../middleware/auth';

const isTeacher = requireRole('teacher');

export default async function teacherRoutes(app: FastifyInstance) {
  app.get('/classes', { preHandler: [isTeacher] }, async (request, reply) => {
    const assignments = await prisma.classBookTeacher.findMany({
      where: { teacherId: request.user.userId },
      include: {
        class: { include: { gradeLevel: true, branch: { include: { school: true } } } },
        book:  { include: { subject: true } },
      },
    });
    reply.send({ data: assignments });
  });

  app.get('/classes/:classId/books/:bookId/report', { preHandler: [isTeacher] }, async (request, reply) => {
    const { classId, bookId } = request.params as { classId: string; bookId: string };

    const enrollments = await prisma.classStudent.findMany({
      where: { classId, bookId },
      include: {
        student: {
          include: {
            progress: { where: { lesson: { bookId } } },
            skillScores: true,
          },
        },
      },
    });

    const totalLessons = await prisma.lesson.count({ where: { bookId } });
    const FOURTEEN_DAYS_AGO = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const perStudent = enrollments.map(e => {
      const s = e.student;
      const completedCount = s.progress.filter(p => p.completedAt).length;
      const recentProgress = s.progress.filter(p =>
        p.completedAt && p.completedAt > FOURTEEN_DAYS_AGO
      );
      const avgScore = s.progress.length > 0
        ? s.progress.reduce((sum, p) => sum + (p.compositeScore || 0), 0) / s.progress.length
        : 0;

      return {
        studentId:        s.id,
        name:             s.name,
        lessonsCompleted: completedCount,
        avgScore:         Math.round(avgScore),
        lessonsThisWeek:  recentProgress.length,
        isAtRisk:         recentProgress.length < Math.ceil(totalLessons * 0.5 / 4),
      };
    });

    const atRiskStudents = perStudent.filter(s => s.isAtRisk);
    const completionRate = enrollments.length > 0
      ? Math.round(perStudent.filter(s => s.lessonsCompleted > 0).length / enrollments.length * 100)
      : 0;

    reply.send({ data: { completionRate, atRiskStudents, perStudent, totalEnrolled: enrollments.length } });
  });

  app.get('/classes/:classId/books/:bookId/students/:studentId', { preHandler: [isTeacher] }, async (request, reply) => {
    const { studentId, bookId } = request.params as { classId: string; bookId: string; studentId: string };

    const progress = await prisma.studentProgress.findMany({
      where: { studentId, lesson: { bookId } },
      include: { lesson: true },
    });

    const skillScores = await prisma.studentSkillScore.findMany({
      where: { studentId, skillTag: { subject: { books: { some: { id: bookId } } } } },
      include: { skillTag: true },
    });

    const strengths  = skillScores.filter(s => s.avgScore >= 80 && s.totalAttempts >= 3);
    const weaknesses = skillScores.filter(s => s.avgScore < 60  && s.totalAttempts >= 3);

    reply.send({ data: { progress, strengths, weaknesses } });
  });
}
