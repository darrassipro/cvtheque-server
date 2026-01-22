import { Response } from 'express';
import { Op } from 'sequelize';
import { User, CV, CVStatus, AuditLog, SystemSettings, UserRole, UserStatus } from '../models/index.js';
import { AuthenticatedRequest, DashboardStats } from '../types/index.js';
import { sequelize } from '../config/database.js';
import { logSettingsChange } from '../middleware/audit.js';

/**
 * Get dashboard statistics
 */
export async function getDashboardStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  // CV Statistics
  const cvStats = await CV.findAll({
    attributes: [
      'status',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    group: ['status'],
    raw: true,
  }) as any[];

  const cvCounts = cvStats.reduce((acc, item) => {
    acc[item.status] = parseInt(item.count, 10);
    return acc;
  }, {} as Record<string, number>);

  const totalCVs = Object.values(cvCounts).reduce((sum: number, count: any) => sum + count, 0);

  // User Statistics
  const userStats = await User.findAll({
    attributes: [
      'status',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    group: ['status'],
    raw: true,
  }) as any[];

  const userCounts = userStats.reduce((acc, item) => {
    acc[item.status] = parseInt(item.count, 10);
    return acc;
  }, {} as Record<string, number>);

  const totalUsers = Object.values(userCounts).reduce((sum: number, count: any) => sum + count, 0);

  // Recent Activity
  const recentActivity = await AuditLog.findAll({
    limit: 10,
    order: [['createdAt', 'DESC']],
    include: [{
      model: User,
      as: 'user',
      attributes: ['id', 'firstName', 'lastName', 'email'],
    }],
  });

  const stats: DashboardStats = {
    totalCVs,
    processedCVs: cvCounts[CVStatus.COMPLETED] || 0,
    pendingCVs: (cvCounts[CVStatus.PENDING] || 0) + (cvCounts[CVStatus.PROCESSING] || 0),
    failedCVs: cvCounts[CVStatus.FAILED] || 0,
    totalUsers,
    activeUsers: userCounts[UserStatus.ACTIVE] || 0,
    recentActivity: recentActivity.map((log: any) => ({
      id: log.id,
      action: log.action,
      resource: log.resource,
      userId: log.userId,
      userName: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System',
      timestamp: log.createdAt,
    })),
  };

  res.json({
    success: true,
    data: stats,
  });
}

/**
 * Get system settings
 */
export async function getSystemSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  const settings = await SystemSettings.findAll();
  
  const settingsMap = settings.reduce((acc, setting) => {
    acc[setting.key] = setting.value;
    return acc;
  }, {} as Record<string, any>);

  res.json({
    success: true,
    data: settingsMap,
  });
}

/**
 * Update a system setting
 */
export async function updateSystemSetting(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = req.body;

  // Handle both single key/value and multiple settings
  const settings = typeof body.key === 'string' 
    ? { [body.key]: body.value }
    : body; // If body is an object with multiple settings

  // Filter out system fields
  const settingsToUpdate = Object.entries(settings)
    .filter(([key]) => !['key', 'value'].includes(key))
    .reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {} as Record<string, any>);

  // Update each setting
  const results = [];
  for (const [key, value] of Object.entries(settingsToUpdate)) {
    const oldSetting = await SystemSettings.findOne({ where: { key } });
    const oldValue = oldSetting?.value;

    await SystemSettings.setSetting(key, value);
    await logSettingsChange(req, key, oldValue, value);
    
    results.push({ key, value, oldValue });
  }

  res.json({
    success: true,
    message: 'Settings updated successfully',
    data: results,
  });
}

/**
 * Get audit logs (with pagination and filtering)
 */
export async function getAuditLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
  const {
    page = 1,
    limit = 50,
    action,
    resource,
    userId,
    startDate,
    endDate,
  } = req.query;

  const pageNum = Number(page);
  const limitNum = Number(limit);
  const offset = (pageNum - 1) * limitNum;

  const where: any = {};

  if (action) where.action = action;
  if (resource) where.resource = resource;
  if (userId) where.userId = userId;

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt[Op.gte] = new Date(startDate as string);
    if (endDate) where.createdAt[Op.lte] = new Date(endDate as string);
  }

  const { rows: logs, count: total } = await AuditLog.findAndCountAll({
    where,
    include: [{
      model: User,
      as: 'user',
      attributes: ['id', 'firstName', 'lastName', 'email'],
    }],
    order: [['createdAt', 'DESC']],
    limit: limitNum,
    offset,
  });

  res.json({
    success: true,
    data: logs,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      hasMore: offset + logs.length < total,
    },
  });
}

/**
 * Get user role statistics
 */
export async function getUserRoleStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  const roleStats = await User.findAll({
    attributes: [
      'role',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    group: ['role'],
    raw: true,
  }) as any[];

  const stats = roleStats.reduce((acc, item) => {
    acc[item.role] = parseInt(item.count, 10);
    return acc;
  }, {} as Record<string, number>);

  res.json({
    success: true,
    data: stats,
  });
}

/**
 * Get CV processing statistics (time-based)
 */
export async function getCVProcessingStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { period = '7d' } = req.query;

  let startDate: Date;
  const endDate = new Date();

  switch (period) {
    case '24h':
      startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '7d':
      startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  // Daily counts
  const dailyStats = await CV.findAll({
    attributes: [
      [sequelize.fn('DATE', sequelize.col('created_at')), 'date'],
      'status',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    where: {
      createdAt: {
        [Op.between]: [startDate, endDate],
      },
    },
    group: [sequelize.fn('DATE', sequelize.col('created_at')), 'status'],
    order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']],
    raw: true,
  });

  // Average processing time for completed CVs (MySQL compatible)
  const avgProcessingTime = await CV.findOne({
    attributes: [
      [
        sequelize.fn(
          'AVG',
          sequelize.literal('TIMESTAMPDIFF(SECOND, processing_started_at, processing_completed_at)')
        ),
        'avgSeconds',
      ],
    ],
    where: {
      status: CVStatus.COMPLETED,
      processingStartedAt: { [Op.not]: null } as any,
      processingCompletedAt: { [Op.not]: null } as any,
      createdAt: { [Op.between]: [startDate, endDate] },
    },
    raw: true,
  }) as any;

  res.json({
    success: true,
    data: {
      period,
      startDate,
      endDate,
      dailyStats,
      averageProcessingTimeSeconds: avgProcessingTime?.avgSeconds || null,
    },
  });
}

/**
 * Health check endpoint
 */
export async function healthCheck(req: AuthenticatedRequest, res: Response): Promise<void> {
  const checks = {
    server: 'healthy',
    database: 'unknown',
    timestamp: new Date().toISOString(),
  };

  try {
    await sequelize.authenticate();
    checks.database = 'healthy';
  } catch {
    checks.database = 'unhealthy';
  }

  const isHealthy = checks.database === 'healthy';

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    data: checks,
  });
}

/**
 * List all users with filtering and pagination
 */
export async function listUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
  const {
    page = 1,
    limit = 20,
    search,
    role,
    status,
    sortBy = 'createdAt',
    sortOrder = 'DESC',
  } = req.query;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const offset = (pageNum - 1) * limitNum;

  // Build where clause
  const whereClause: any = {};

  if (search) {
    whereClause[Op.or] = [
      { firstName: { [Op.like]: `%${search}%` } },
      { lastName: { [Op.like]: `%${search}%` } },
      { email: { [Op.like]: `%${search}%` } },
    ];
  }

  if (role) {
    whereClause.role = role;
  }

  if (status) {
    whereClause.status = status;
  }

  // Get users with pagination
  const { count, rows: users } = await User.findAndCountAll({
    where: whereClause,
    limit: limitNum,
    offset,
    order: [[sortBy as string, sortOrder as string]],
    attributes: { exclude: ['password'] },
  });

  res.json({
    success: true,
    data: {
      users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil(count / limitNum),
      },
    },
  });
}

/**
 * Get user by ID
 */
export async function getUserById(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;

  const user = await User.findByPk(id, {
    attributes: { exclude: ['password'] },
  });

  if (!user) {
    res.status(404).json({
      success: false,
      error: 'User not found',
    });
    return;
  }

  res.json({
    success: true,
    data: user,
  });
}

/**
 * Update user role
 */
export async function updateUserRole(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const { role } = req.body;

  if (!Object.values(UserRole).includes(role)) {
    res.status(400).json({
      success: false,
      error: 'Invalid role',
    });
    return;
  }

  const user = await User.findByPk(id);
  if (!user) {
    res.status(404).json({
      success: false,
      error: 'User not found',
    });
    return;
  }

  const oldRole = user.role;
  user.role = role;
  await user.save();

  // Log the change
  await AuditLog.create({
    userId: req.user!.userId,
    action: 'UPDATE',
    resource: 'User',
    resourceId: id,
    details: {
      field: 'role',
      oldValue: oldRole,
      newValue: role,
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.json({
    success: true,
    data: user,
  });
}

/**
 * Update user status
 */
export async function updateUserStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const { status } = req.body;

  if (!Object.values(UserStatus).includes(status)) {
    res.status(400).json({
      success: false,
      error: 'Invalid status',
    });
    return;
  }

  const user = await User.findByPk(id);
  if (!user) {
    res.status(404).json({
      success: false,
      error: 'User not found',
    });
    return;
  }

  const oldStatus = user.status;
  user.status = status;
  await user.save();

  // Log the change
  await AuditLog.create({
    userId: req.user!.userId,
    action: 'UPDATE',
    resource: 'User',
    resourceId: id,
    details: {
      field: 'status',
      oldValue: oldStatus,
      newValue: status,
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.json({
    success: true,
    data: user,
  });
}

/**
 * Delete user
 */
export async function deleteUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;

  const user = await User.findByPk(id);
  if (!user) {
    res.status(404).json({
      success: false,
      error: 'User not found',
    });
    return;
  }

  // Prevent deleting superadmin
  if (user.role === UserRole.SUPERADMIN) {
    res.status(403).json({
      success: false,
      error: 'Cannot delete superadmin user',
    });
    return;
  }

  // Log before deletion
  await AuditLog.create({
    userId: req.user!.userId,
    action: 'DELETE',
    resource: 'User',
    resourceId: id,
    details: {
      email: user.email,
      role: user.role,
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  await user.destroy();

  res.json({
    success: true,
    message: 'User deleted successfully',
  });
}