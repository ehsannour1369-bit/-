import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const adminHash = await bcrypt.hash('Admin1234!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@okidd.ir' },
    update: {},
    create: { email: 'admin@okidd.ir', passwordHash: adminHash, name: 'مدیر اوکیدد', role: 'admin' },
  });
  console.log('✓ Admin created:', admin.email);

  const grade1 = await prisma.gradeLevel.upsert({
    where: { level: 1 },
    update: {},
    create: { level: 1, stage: 'primary' },
  });

  const math  = await prisma.subject.create({ data: { name: 'ریاضی اول',  gradeLevelId: grade1.id } });
  const farsi = await prisma.subject.create({ data: { name: 'فارسی اول', gradeLevelId: grade1.id } });

  const mathBook  = await prisma.book.create({ data: { title: 'ریاضی پایه اول دبستان',  subjectId: math.id,  price: 150000 } });
  const farsiBook = await prisma.book.create({ data: { title: 'فارسی پایه اول دبستان', subjectId: farsi.id, price: 150000 } });

  const tags = await Promise.all([
    prisma.skillTag.create({ data: { name: 'جمع ساده',     subjectId: math.id } }),
    prisma.skillTag.create({ data: { name: 'تفریق ساده',   subjectId: math.id } }),
    prisma.skillTag.create({ data: { name: 'شناخت اعداد',  subjectId: math.id } }),
    prisma.skillTag.create({ data: { name: 'شناخت حروف',   subjectId: farsi.id } }),
    prisma.skillTag.create({ data: { name: 'درک مطلب',     subjectId: farsi.id } }),
  ]);
  console.log('✓ Skill tags created:', tags.length);

  const lessonsData = [
    { bookId: mathBook.id, chapterNo: 1, lessonNo: 1, title: 'شناخت اعداد ۱ تا ۵',  schoolProgressUnlocked: true,  okiddChartUnlockWeek: 1 },
    { bookId: mathBook.id, chapterNo: 1, lessonNo: 2, title: 'شناخت اعداد ۶ تا ۱۰', schoolProgressUnlocked: true,  okiddChartUnlockWeek: 2 },
    { bookId: mathBook.id, chapterNo: 1, lessonNo: 3, title: 'جمع ساده',             schoolProgressUnlocked: true,  okiddChartUnlockWeek: 3 },
    { bookId: mathBook.id, chapterNo: 1, lessonNo: 4, title: 'تفریق ساده',           schoolProgressUnlocked: true,  okiddChartUnlockWeek: 4 },
    { bookId: mathBook.id, chapterNo: 2, lessonNo: 1, title: 'اعداد تا ۲۰',          schoolProgressUnlocked: false, okiddChartUnlockWeek: 6 },
  ];

  for (const l of lessonsData) {
    const lesson = await prisma.lesson.create({ data: l });

    await prisma.exercise.create({
      data: {
        lessonId: lesson.id,
        createdBy: admin.id,
        questionsJson: [
          { question: 'سوال نمونه ۱', options: ['الف', 'ب', 'ج', 'د'], correctIndex: 1, skillTagIds: [tags[0].id] },
          { question: 'سوال نمونه ۲', options: ['الف', 'ب', 'ج', 'د'], correctIndex: 2, skillTagIds: [tags[0].id] },
        ],
      },
    });

    await prisma.quiz.create({
      data: {
        lessonId: lesson.id,
        createdBy: admin.id,
        timeLimitSec: 30,
        questionsJson: [
          { question: 'سوال آزمون ۱', options: ['الف', 'ب', 'ج'], correctIndex: 1, skillTagIds: [tags[0].id] },
          { question: 'سوال آزمون ۲', options: ['الف', 'ب', 'ج'], correctIndex: 0, skillTagIds: [tags[1].id] },
        ],
      },
    });
  }
  console.log('✓ Lessons + exercises + quizzes created');

  const avatars = await Promise.all([
    prisma.avatar.create({ data: { name: 'شیر',   emoji: '🦁', themeConfigJson: { primary: '#7c3aed' } } }),
    prisma.avatar.create({ data: { name: 'پاندا', emoji: '🐼', themeConfigJson: { primary: '#374151' } } }),
    prisma.avatar.create({ data: { name: 'روباه', emoji: '🦊', themeConfigJson: { primary: '#ea580c' } } }),
  ]);

  await Promise.all([
    prisma.avatarGadget.create({ data: { name: 'تاج',       emoji: '👑', pointCost: 50  } }),
    prisma.avatarGadget.create({ data: { name: 'موشک',      emoji: '🚀', pointCost: 150 } }),
    prisma.avatarGadget.create({ data: { name: 'عصای جادو', emoji: '🪄', pointCost: 200 } }),
  ]);

  const studentHash = await bcrypt.hash('Student1234!', 12);
  const student = await prisma.user.upsert({
    where: { email: 'student@okidd.ir' },
    update: {},
    create: {
      email: 'student@okidd.ir', passwordHash: studentHash,
      name: 'علی احمدی', role: 'student', avatarId: avatars[0].id,
    },
  });

  const parentHash = await bcrypt.hash('Parent1234!', 12);
  const parent = await prisma.user.upsert({
    where: { email: 'parent@okidd.ir' },
    update: {},
    create: { email: 'parent@okidd.ir', passwordHash: parentHash, name: 'والد نمونه', role: 'parent' },
  });

  const teacherHash = await bcrypt.hash('Teacher1234!', 12);
  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@okidd.ir' },
    update: {},
    create: { email: 'teacher@okidd.ir', passwordHash: teacherHash, name: 'خانم رضایی', role: 'teacher' },
  });

  const schoolUserHash = await bcrypt.hash('School1234!', 12);
  const schoolUser = await prisma.user.upsert({
    where: { email: 'school@okidd.ir' },
    update: {},
    create: { email: 'school@okidd.ir', passwordHash: schoolUserHash, name: 'مدیر دبستان', role: 'school' },
  });

  const school = await prisma.school.create({
    data: { name: 'دبستان امام علی', ownerId: schoolUser.id, city: 'تهران' },
  });

  const branch = await prisma.branch.create({
    data: { schoolId: school.id, name: 'شعبه مرکزی', gender: 'mixed', city: 'تهران' },
  });

  const cls = await prisma.class.create({
    data: { branchId: branch.id, gradeLevelId: grade1.id, name: 'کلاس ۱-الف' },
  });

  await prisma.bookGrant.create({
    data: { bookId: mathBook.id, grantedToId: school.id, quantity: 100, grantedById: admin.id },
  });

  await prisma.classStudent.create({
    data: { classId: cls.id, bookId: mathBook.id, studentId: student.id },
  });

  await prisma.classBookTeacher.create({
    data: { classId: cls.id, bookId: mathBook.id, teacherId: teacher.id },
  });

  await prisma.parentStudent.create({
    data: { parentId: parent.id, studentId: student.id, confirmedAt: new Date() },
  });

  await prisma.pointsLedger.create({
    data: { userId: student.id, activityType: 'VIDEO_WATCH',   pointsDelta: 100, balanceAfter: 100 },
  });
  await prisma.pointsLedger.create({
    data: { userId: student.id, activityType: 'QUIZ_COMPLETE', pointsDelta: 180, balanceAfter: 280 },
  });

  console.log('');
  console.log('✅ Seed complete! Demo accounts:');
  console.log('   admin@okidd.ir   / Admin1234!');
  console.log('   school@okidd.ir  / School1234!');
  console.log('   teacher@okidd.ir / Teacher1234!');
  console.log('   parent@okidd.ir  / Parent1234!');
  console.log('   student@okidd.ir / Student1234!');

  // suppress unused var warning
  void farsiBook;
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
