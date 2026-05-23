import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../index';
import { requireRole } from '../middleware/auth';
import { awardPoints, getBalance } from '../services/points';

const isStudent = requireRole('student', 'student_temp');

export default async function studentRoutes(app: FastifyInstance) {
  app.get('/profile', { preHandler: [isStudent] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, name: true, role: true, avatarId: true, gradeLevelId: true,
                currentSchoolId: true, avatar: true, gradeLevel: true },
    });
    const balance = await getBalance(request.user.userId);
    reply.send({ data: { ...user, pointsBalance: balance } });
  });

  app.get('/books', { preHandler: [isStudent] }, async (request, reply) => {
    const studentId = request.user.userId;
    const enrollments = await prisma.classStudent.findMany({
      where: { studentId },
      include: {
        book: { include: { subject: { include: { gradeLevel: true } } } },
        class: true,
      },
      distinct: ['bookId'],
    });

    const booksWithProgress = await Promise.all(enrollments.map(async e => {
      const [totalLessons, completedLessons] = await Promise.all([
        prisma.lesson.count({ where: { bookId: e.bookId } }),
        prisma.studentProgress.count({
          where: { studentId, lesson: { bookId: e.bookId }, completedAt: { not: null } },
        }),
      ]);
      return { ...e.book, totalLessons, completedLessons };
    }));

    reply.send({ data: booksWithProgress });
  });

  app.get('/books/:bookId/lessons', { preHandler: [isStudent] }, async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const studentId = request.user.userId;

    const lessons = await prisma.lesson.findMany({
      where: { bookId },
      include: {
        videos:    { select: { id: true, hlsUrl: true, durationSec: true } },
        games:     { select: { id: true, htmlFileUrl: true } },
        exercises: { select: { id: true } },
        quizzes:   { select: { id: true, timeLimitSec: true } },
      },
      orderBy: [{ chapterNo: 'asc' }, { lessonNo: 'asc' }],
    });

    const progressList = await prisma.studentProgress.findMany({
      where: { studentId, lesson: { bookId } },
    });
    const progressMap = Object.fromEntries(progressList.map(p => [p.lessonId, p]));

    const result = lessons.map(l => ({
      ...l,
      progress:   progressMap[l.id] || null,
      isUnlocked: l.schoolProgressUnlocked,
    }));

    reply.send({ data: result });
  });

  app.post('/lessons/:lessonId/video-complete', { preHandler: [isStudent] }, async (request, reply) => {
    const { lessonId } = request.params as { lessonId: string };
    const studentId = request.user.userId;

    const progress = await prisma.studentProgress.upsert({
      where: { studentId_lessonId: { studentId, lessonId } },
      create: { studentId, lessonId, videoWatched: true },
      update: { videoWatched: true },
    });
    const balance = await awardPoints(studentId, 'VIDEO_WATCH', 10, lessonId);
    reply.send({ data: { progress, newBalance: balance } });
  });

  app.post('/lessons/:lessonId/game-complete', { preHandler: [isStudent] }, async (request, reply) => {
    const { lessonId } = request.params as { lessonId: string };
    const studentId = request.user.userId;
    const schema = z.object({ score: z.number().min(0).max(100) });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const { score } = result.data;
    const points = score >= 80 ? 40 : score >= 60 ? 20 : 10;
    const progress = await updateComposite(studentId, lessonId, { gameScore: score });
    const balance = await awardPoints(studentId, 'GAME_COMPLETE', points, lessonId);
    reply.send({ data: { progress, pointsEarned: points, newBalance: balance } });
  });

  app.post('/lessons/:lessonId/exercise-submit', { preHandler: [isStudent] }, async (request, reply) => {
    const { lessonId } = request.params as { lessonId: string };
    const studentId = request.user.userId;
    const schema = z.object({
      answers: z.array(z.object({ questionIndex: z.number(), selectedIndex: z.number() })),
    });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const exercise = await prisma.exercise.findFirst({ where: { lessonId } });
    if (!exercise) return reply.status(404).send({ error: 'Exercise not found' });

    const questions = exercise.questionsJson as Array<{ correctIndex: number; skillTagIds?: string[] }>;
    let correct = 0;
    for (const ans of result.data.answers) {
      if (questions[ans.questionIndex]?.correctIndex === ans.selectedIndex) correct++;
    }
    const score = Math.round((correct / questions.length) * 100);
    const progress = await updateComposite(studentId, lessonId, { exerciseScore: score });
    const balance = await awardPoints(studentId, 'EXERCISE_SUBMIT', 15, lessonId);
    reply.send({ data: { score, correct, total: questions.length, progress, newBalance: balance } });
  });

  app.post('/lessons/:lessonId/quiz-submit', { preHandler: [isStudent] }, async (request, reply) => {
    const { lessonId } = request.params as { lessonId: string };
    const studentId = request.user.userId;
    const schema = z.object({
      answers: z.array(z.object({ questionIndex: z.number(), selectedIndex: z.number() })),
    });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const quiz = await prisma.quiz.findFirst({ where: { lessonId } });
    if (!quiz) return reply.status(404).send({ error: 'Quiz not found' });

    const questions = quiz.questionsJson as Array<{ correctIndex: number }>;
    let correct = 0;
    for (const ans of result.data.answers) {
      if (questions[ans.questionIndex]?.correctIndex === ans.selectedIndex) correct++;
    }
    const score = Math.round((correct / questions.length) * 100);
    const pts = score === 100 ? 60 : score >= 80 ? 40 : 20;
    const progress = await updateComposite(studentId, lessonId, { quizScore: score });
    const balance = await awardPoints(studentId, 'QUIZ_COMPLETE', pts, lessonId);
    reply.send({ data: { score, correct, total: questions.length, pointsEarned: pts, progress, newBalance: balance } });
  });

  app.patch('/avatar', { preHandler: [isStudent] }, async (request, reply) => {
    const schema = z.object({ avatarId: z.string() });
    const result = schema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const user = await prisma.user.update({
      where: { id: request.user.userId },
      data: { avatarId: result.data.avatarId },
      select: { id: true, avatarId: true },
    });
    reply.send({ data: user });
  });

  app.post('/gadgets/:gadgetId/unlock', { preHandler: [isStudent] }, async (request, reply) => {
    const { gadgetId } = request.params as { gadgetId: string };
    const studentId = request.user.userId;

    const gadget = await prisma.avatarGadget.findUnique({ where: { id: gadgetId } });
    if (!gadget) return reply.status(404).send({ error: 'Gadget not found' });

    const balance = await getBalance(studentId);
    if (balance < gadget.pointCost) return reply.status(400).send({ error: 'Insufficient points' });

    const unlock = await prisma.studentAvatarGadget.create({ data: { studentId, gadgetId } });
    const newBalance = await awardPoints(studentId, 'GADGET_PURCHASE', -gadget.pointCost, gadgetId);
    reply.status(201).send({ data: { unlock, newBalance } });
  });
}

async function updateComposite(studentId: string, lessonId: string, update: Record<string, number>) {
  const current = await prisma.studentProgress.upsert({
    where: { studentId_lessonId: { studentId, lessonId } },
    create: { studentId, lessonId, ...update },
    update,
  });

  const video    = current.videoWatched ? 10 : 0;
  const game     = (current.gameScore     || 0) * 0.25;
  const exercise = (current.exerciseScore || 0) * 0.25;
  const quiz     = (current.quizScore     || 0) * 0.40;
  const composite = video + game + exercise + quiz;

  const isComplete = current.videoWatched
    && current.gameScore !== null
    && current.exerciseScore !== null
    && current.quizScore !== null;

  return prisma.studentProgress.update({
    where: { studentId_lessonId: { studentId, lessonId } },
    data: { compositeScore: composite, completedAt: isComplete ? new Date() : null },
  });
}
