import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';

const registerSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name:     z.string().min(2),
  role:     z.enum(['admin', 'school', 'school_temp', 'teacher', 'teacher_temp',
                    'parent', 'parent_temp', 'student', 'student_temp']),
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string(),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (request, reply) => {
    const result = registerSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: result.error.errors[0].message });

    const { email, password, name, role } = result.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.status(409).send({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    });

    const token = app.jwt.sign({ userId: user.id, email: user.email, role: user.role });
    reply.status(201).send({ data: { token, user } });
  });

  app.post('/login', async (request, reply) => {
    const result = loginSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: 'Invalid request' });

    const { email, password } = result.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.status(401).send({ error: 'Invalid email or password' });
    if (user.status === 'suspended') return reply.status(403).send({ error: 'Account suspended' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return reply.status(401).send({ error: 'Invalid email or password' });

    const token = app.jwt.sign({ userId: user.id, email: user.email, role: user.role });
    reply.send({ data: {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    }});
  });

  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, email: true, name: true, role: true, status: true,
                avatarId: true, currentSchoolId: true, gradeLevelId: true },
    });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    reply.send({ data: user });
  });
}
