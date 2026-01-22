import { Response, NextFunction } from 'express';
import { AuditLog, AuditAction } from '../models/index.js';
import { AuthenticatedRequest } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Get client IP address from request
 */
function getClientIp(req: AuthenticatedRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Get user agent from request
 */
function getUserAgent(req: AuthenticatedRequest): string {
  return req.headers['user-agent'] || 'unknown';
}

/**
 * Log an audit event
 */
export async function logAudit(
  req: AuthenticatedRequest,
  action: AuditAction,
  resource: string,
  resourceId?: string,
  details?: Record<string, any>
): Promise<void> {
  try {
    await AuditLog.create({
      userId: req.user?.userId,
      action,
      resource,
      resourceId,
      details,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });
  } catch (error) {
    logger.error('Failed to create audit log:', error);
  }
}

/**
 * Audit middleware factory
 * Creates middleware that logs specific actions
 * 
 * @example
 * router.post('/cv', authenticate, audit(AuditAction.UPLOAD, 'cv'), handler);
 */
export function audit(action: AuditAction, resource: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json method to capture response
    res.json = function (body: any) {
      // Log audit after successful operation
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const resourceId = body?.data?.id || req.params.id;
        logAudit(req, action, resource, resourceId, {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
        });
      }
      return originalJson(body);
    };

    next();
  };
}

/**
 * Log authentication events
 */
export async function logAuthEvent(
  req: AuthenticatedRequest,
  action: AuditAction.LOGIN | AuditAction.LOGOUT,
  userId?: string,
  success: boolean = true,
  details?: Record<string, any>
): Promise<void> {
  try {
    await AuditLog.create({
      userId,
      action,
      resource: 'auth',
      details: {
        success,
        ...details,
      },
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });
  } catch (error) {
    logger.error('Failed to log auth event:', error);
  }
}

/**
 * Log settings changes
 */
export async function logSettingsChange(
  req: AuthenticatedRequest,
  settingKey: string,
  oldValue: any,
  newValue: any
): Promise<void> {
  await logAudit(req, AuditAction.SETTINGS_CHANGE, 'settings', settingKey, {
    oldValue,
    newValue,
  });
}