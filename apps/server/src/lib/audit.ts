import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Creates an entry in the AuditLog database table.
 * Does not throw on failure to prevent database logging issues from breaking core workflows.
 */
export async function createAuditLog(
  userId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  meta?: Record<string, unknown> | null,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        meta: (meta ?? undefined) as any,
      },
    });
  } catch (error) {
    logger.error(`Failed to write audit log for user ${userId}, action ${action}:`, error);
  }
}
