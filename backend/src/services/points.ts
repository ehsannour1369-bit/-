import { prisma } from '../index';

export async function getBalance(userId: string): Promise<number> {
  const result = await prisma.pointsLedger.aggregate({
    where: { userId },
    _sum: { pointsDelta: true },
  });
  return result._sum.pointsDelta || 0;
}

export async function awardPoints(
  userId: string,
  activityType: string,
  points: number,
  refId?: string
): Promise<number> {
  const currentBalance = await getBalance(userId);
  const newBalance = currentBalance + points;
  await prisma.pointsLedger.create({
    data: { userId, activityType, pointsDelta: points, balanceAfter: newBalance, refId },
  });
  return newBalance;
}
