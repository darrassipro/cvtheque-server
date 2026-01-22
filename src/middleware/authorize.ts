import { Response, NextFunction } from 'express';
import { UserRole } from '../models/index.js';
import { AuthenticatedRequest } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Role hierarchy: SUPERADMIN > ADMIN > MODERATOR > USER
 */
const roleHierarchy: Record<UserRole, number> = {
  [UserRole.SUPERADMIN]: 4,
  [UserRole.ADMIN]: 3,
  [UserRole.MODERATOR]: 2,
  [UserRole.USER]: 1,
};

/**
 * Check if a role has equal or higher privileges than another
 */
function hasRoleOrHigher(userRole: UserRole, requiredRole: UserRole): boolean {
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

/**
 * Authorization Middleware Factory
 * Restricts access based on allowed roles
 * 
 * @param allowedRoles - Array of roles that can access the route
 * @returns Express middleware function
 * 
 * @example
 * // Only SUPERADMIN and ADMIN can access
 * router.get('/admin-only', authenticate, authorize([UserRole.SUPERADMIN, UserRole.ADMIN]), handler);
 * 
 * // Any authenticated user can access
 * router.get('/any-user', authenticate, authorize([UserRole.USER]), handler);
 */
export function authorize(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
          message: 'You must be logged in to access this resource',
        });
        return;
      }

      const userRole = req.user.role;
      
      // Check if user has any of the allowed roles or higher
      const hasPermission = allowedRoles.some(role => hasRoleOrHigher(userRole, role));

      if (!hasPermission) {
        logger.warn(`Authorization denied for user ${req.user.userId} (${userRole}) attempting to access resource requiring ${allowedRoles.join(', ')}`);
        
        res.status(403).json({
          success: false,
          error: 'Access denied',
          message: 'You do not have permission to access this resource',
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Authorization error:', error);
      res.status(500).json({
        success: false,
        error: 'Authorization failed',
        message: 'An error occurred during authorization',
      });
    }
  };
}

/**
 * Require SUPERADMIN role only
 */
export function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  return authorize([UserRole.SUPERADMIN])(req, res, next);
}

/**
 * Require ADMIN or higher role
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  return authorize([UserRole.ADMIN])(req, res, next);
}

/**
 * Require MODERATOR or higher role
 */
export function requireModerator(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  return authorize([UserRole.MODERATOR])(req, res, next);
}

/**
 * Require any authenticated USER or higher
 */
export function requireUser(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  return authorize([UserRole.USER])(req, res, next);
}

/**
 * Check if user owns the resource or has admin privileges
 * 
 * @param getResourceUserId - Function to extract resource owner ID from request
 * @returns Express middleware function
 * 
 * @example
 * router.put('/cv/:id', authenticate, requireOwnerOrAdmin(req => req.params.userId), handler);
 */
export function requireOwnerOrAdmin(getResourceUserId: (req: AuthenticatedRequest) => string | undefined) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const resourceUserId = getResourceUserId(req);
      const isOwner = resourceUserId === req.user.userId;
      const isAdmin = hasRoleOrHigher(req.user.role, UserRole.ADMIN);

      if (!isOwner && !isAdmin) {
        res.status(403).json({
          success: false,
          error: 'Access denied',
          message: 'You can only access your own resources or be an administrator',
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Owner check error:', error);
      res.status(500).json({
        success: false,
        error: 'Authorization failed',
      });
    }
  };
}

/**
 * Check if user can modify another user (based on role hierarchy)
 * SUPERADMIN can modify anyone
 * ADMIN can modify MODERATOR and USER
 * MODERATOR can modify USER only
 * USER can only modify themselves
 */
export function canModifyUser(actorRole: UserRole, targetRole: UserRole, actorId: string, targetId: string): boolean {
  // Users can always modify themselves
  if (actorId === targetId) return true;
  
  // Check role hierarchy
  return roleHierarchy[actorRole] > roleHierarchy[targetRole];
}

/**
 * Middleware to ensure user can only modify lower-ranked users
 */
export function requireHigherRole(getTargetRole: (req: AuthenticatedRequest) => Promise<UserRole | undefined>) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const targetRole = await getTargetRole(req);
      
      if (!targetRole) {
        res.status(404).json({
          success: false,
          error: 'Target user not found',
        });
        return;
      }

      if (roleHierarchy[req.user.role] <= roleHierarchy[targetRole]) {
        res.status(403).json({
          success: false,
          error: 'Access denied',
          message: 'You cannot modify users with equal or higher role',
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Higher role check error:', error);
      res.status(500).json({
        success: false,
        error: 'Authorization failed',
      });
    }
  };
}