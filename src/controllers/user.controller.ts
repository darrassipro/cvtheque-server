import { Response } from 'express';
import { Op } from 'sequelize';
import { User, UserRole, UserStatus, CV, CVExtractedData, CVStatus } from '../models/index.js';
import { AuthenticatedRequest } from '../types/index.js';
import { NotFoundError, ForbiddenError, ConflictError, ServiceUnavailableError, ValidationError } from '../middleware/errorHandler.js';
import { canModifyUser } from '../middleware/authorize.js';
import { logAudit } from '../middleware/audit.js';
import { AuditAction } from '../models/AuditLog.js';
import { getCloudinaryService } from '../services/storage/cloudinary.js';
import { cleanupUploadedFile } from '../middleware/upload.js';
import fs from 'fs';

/**
 * List all users (with pagination and filtering)
 */
export async function listUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { page = 1, limit = 20, role, status, search } = req.query;

  const pageNum = Number(page);
  const limitNum = Number(limit);
  const offset = (pageNum - 1) * limitNum;

  // Build where clause
  const where: any = {};

  if (role) {
    where.role = role;
  }

  if (status) {
    where.status = status;
  }

  if (search) {
    where[Op.or] = [
      { email: { [Op.like]: `%${search}%` } },
      { firstName: { [Op.like]: `%${search}%` } },
      { lastName: { [Op.like]: `%${search}%` } },
    ];
  }

  const { rows: users, count: total } = await User.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: limitNum,
    offset,
    attributes: { exclude: ['password'] },
  });

  res.json({
    success: true,
    data: users,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      hasMore: offset + users.length < total,
    },
  });
}

/**
 * Get a single user by ID
 */
export async function getUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const user = await User.findByPk(id, {
    attributes: { exclude: ['password'] },
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  res.json({
    success: true,
    data: user,
  });
}

/**
 * Create a new user (admin only)
 */
export async function createUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { email, password, firstName, lastName, role, status } = req.body;

  // Check if user exists
  const existing = await User.findOne({ where: { email } });
  if (existing) {
    throw new ConflictError('A user with this email already exists');
  }

  // Check role permissions
  if (role && req.user) {
    const allowedRoles = getAllowedRolesToCreate(req.user.role);
    if (!allowedRoles.includes(role)) {
      throw new ForbiddenError(`You cannot create users with role: ${role}`);
    }
  }

  const user = await User.create({
    email,
    password,
    firstName,
    lastName,
    role: role || UserRole.USER,
    status: status || UserStatus.ACTIVE,
  });

  await logAudit(req, AuditAction.CREATE, 'user', user.id);

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: user.toJSON(),
  });
}

/**
 * Update a user
 */
export async function updateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;
  const { firstName, lastName, avatar, status } = req.body;

  const user = await User.findByPk(id);
  if (!user) {
    throw new NotFoundError('User');
  }

  // Check permissions
  if (req.user && !canModifyUser(req.user.role, user.role, req.user.userId, id)) {
    throw new ForbiddenError('You cannot modify this user');
  }

  await user.update({
    ...(firstName && { firstName }),
    ...(lastName && { lastName }),
    ...(avatar !== undefined && { avatar }),
    ...(status && { status }),
  });

  await logAudit(req, AuditAction.UPDATE, 'user', user.id);

  res.json({
    success: true,
    message: 'User updated successfully',
    data: user.toJSON(),
  });
}

/**
 * Update user role (superadmin/admin only)
 */
export async function updateUserRole(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;
  const { role } = req.body;

  const user = await User.findByPk(id);
  if (!user) {
    throw new NotFoundError('User');
  }

  // Cannot change own role
  if (req.user?.userId === id) {
    throw new ForbiddenError('You cannot change your own role');
  }

  // Check if can assign this role
  if (req.user) {
    const allowedRoles = getAllowedRolesToCreate(req.user.role);
    if (!allowedRoles.includes(role)) {
      throw new ForbiddenError(`You cannot assign role: ${role}`);
    }
  }

  // Check if can modify this user
  if (req.user && !canModifyUser(req.user.role, user.role, req.user.userId, id)) {
    throw new ForbiddenError('You cannot modify this user');
  }

  await user.update({ role });

  await logAudit(req, AuditAction.UPDATE, 'user', user.id, { roleChanged: role });

  res.json({
    success: true,
    message: 'User role updated successfully',
    data: user.toJSON(),
  });
}

/**
 * Delete a user
 */
export async function deleteUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const user = await User.findByPk(id);
  if (!user) {
    throw new NotFoundError('User');
  }

  // Cannot delete self
  if (req.user?.userId === id) {
    throw new ForbiddenError('You cannot delete your own account');
  }

  // Check permissions
  if (req.user && !canModifyUser(req.user.role, user.role, req.user.userId, id)) {
    throw new ForbiddenError('You cannot delete this user');
  }

  // Cannot delete superadmin
  if (user.role === UserRole.SUPERADMIN) {
    throw new ForbiddenError('Cannot delete superadmin account');
  }

  await logAudit(req, AuditAction.DELETE, 'user', user.id);

  await user.destroy();

  res.json({
    success: true,
    message: 'User deleted successfully',
  });
}

/**
 * Activate a user
 */
export async function activateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const user = await User.findByPk(id);
  if (!user) {
    throw new NotFoundError('User');
  }

  await user.update({ status: UserStatus.ACTIVE });

  await logAudit(req, AuditAction.UPDATE, 'user', user.id, { activated: true });

  res.json({
    success: true,
    message: 'User activated successfully',
    data: user.toJSON(),
  });
}

/**
 * Suspend a user
 */
export async function suspendUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const user = await User.findByPk(id);
  if (!user) {
    throw new NotFoundError('User');
  }

  // Cannot suspend self
  if (req.user?.userId === id) {
    throw new ForbiddenError('You cannot suspend your own account');
  }

  // Cannot suspend superadmin
  if (user.role === UserRole.SUPERADMIN) {
    throw new ForbiddenError('Cannot suspend superadmin account');
  }

  // Check permissions
  if (req.user && !canModifyUser(req.user.role, user.role, req.user.userId, id)) {
    throw new ForbiddenError('You cannot suspend this user');
  }

  await user.update({ status: UserStatus.SUSPENDED });

  await logAudit(req, AuditAction.UPDATE, 'user', user.id, { suspended: true });

  res.json({
    success: true,
    message: 'User suspended successfully',
    data: user.toJSON(),
  });
}

/**
 * Get current user's profile
 */
export async function getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  const user = await User.findByPk(req.user.userId, {
    attributes: { exclude: ['password'] },
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  res.json({
    success: true,
    data: user.toJSON(),
  });
}

/**
 * Update current user's profile
 */
export async function updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  const { firstName, lastName, email, phone } = req.body;

  const user = await User.findByPk(req.user.userId);
  if (!user) {
    throw new NotFoundError('User');
  }

  // Check if email is being changed and if it's already taken
  if (email && email !== user.email) {
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      throw new ConflictError('Email already in use');
    }
  }

  await user.update({
    ...(firstName !== undefined && { firstName }),
    ...(lastName !== undefined && { lastName }),
    ...(email !== undefined && { email }),
    ...(phone !== undefined && { phone }),
  });

  await logAudit(req, AuditAction.UPDATE, 'user', user.id);

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: user.toJSON(),
  });
}

/**
 * Upload and update current user's avatar (profile photo)
 * - Accepts a single image file via multipart/form-data field `avatar`
 * - Stores in Cloudinary under a per-user folder with face crop + auto quality
 */
export async function uploadProfileAvatar(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  const file = req.file as Express.Multer.File | undefined;
  if (!file) {
    throw new ValidationError('No avatar file provided');
  }

  const cloudinary = getCloudinaryService();
  if (!cloudinary.isAvailable()) {
    await cleanupUploadedFile(file.path);
    throw new ServiceUnavailableError('Cloudinary is not configured');
  }

  const user = await User.findByPk(req.user.userId);
  if (!user) {
    await cleanupUploadedFile(file.path);
    throw new NotFoundError('User');
  }

  try {
    const buffer = await fs.promises.readFile(file.path);
    const uploadResult = await cloudinary.uploadProfilePhoto(buffer, {
      folder: `cvtech/users/${user.id}`,
      publicId: `avatar_${user.id}`,
    });

    await user.update({ avatar: uploadResult.secureUrl });
    await logAudit(req, AuditAction.UPDATE, 'user', user.id, { avatarUpdated: true });

    // Also update the user's default CV extracted data with the new avatar
    // so CVCards display the updated profile photo
    const defaultCV = await CV.findOne({
      where: {
        userId: req.user.userId,
        isDefault: true,
        status: CVStatus.COMPLETED,
      },
      include: [{
        model: CVExtractedData,
        as: 'extractedData',
        required: false,
      }],
    });

    if (defaultCV) {
      const extractedData = (defaultCV as any).extractedData as CVExtractedData | null;
      if (extractedData) {
        await extractedData.update({
          photo: uploadResult.secureUrl,
        });
      }
    }

    res.json({
      success: true,
      message: 'Avatar updated successfully',
      data: {
        avatar: uploadResult.secureUrl,
        publicId: uploadResult.publicId,
      },
    });
  } finally {
    await cleanupUploadedFile(file.path);
  }
}

/**
 * Get current user's CV information
 */
export async function getProfileCV(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  // Get user's default completed CV with extracted data
  const cv = await CV.findOne({
    where: {
      userId: req.user.userId,
      status: CVStatus.COMPLETED,
      isDefault: true,
    },
    include: [{
      model: CVExtractedData,
      as: 'extractedData',
      required: false,
    }],
  });

  const extractedData = (cv as any).extractedData as CVExtractedData | null;
  
  if (!cv || !extractedData) {
    res.json({
      success: true,
      data: null,
      message: 'No CV data found',
    });
    return;
  }

  res.json({
    success: true,
    data: {
      cvId: cv.id,
      ...extractedData.toJSON(),
    },
  });
}

/**
 * Update current user's CV information
 */
export async function updateProfileCV(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  const {
    fullName,
    email,
    phone,
    location,
    city,
    country,
    age,
    gender,
    education,
    experience,
    skills,
    languages,
    certifications,
    internships,
  } = req.body;

  // Get user's most recent completed CV
  const cv = await CV.findOne({
    where: {
      userId: req.user.userId,
      status: CVStatus.COMPLETED,
    },
    include: [{
      model: CVExtractedData,
      as: 'extractedData',
      required: false,
    }],
    order: [['createdAt', 'DESC']],
  });

  if (!cv) {
    throw new NotFoundError('No CV found. Please upload a CV first.');
  }

  const extractedData = (cv as any).extractedData as CVExtractedData | null;
  
  if (!extractedData) {
    throw new NotFoundError('CV data not available. Please wait for CV processing to complete.');
  }

  // Update extracted data
  await extractedData.update({
    ...(fullName !== undefined && { fullName }),
    ...(email !== undefined && { email }),
    ...(phone !== undefined && { phone }),
    ...(location !== undefined && { location }),
    ...(city !== undefined && { city }),
    ...(country !== undefined && { country }),
    ...(age !== undefined && { age: age ? parseInt(age.toString()) : null }),
    ...(gender !== undefined && { gender }),
    ...(education !== undefined && { education }),
    ...(experience !== undefined && { experience }),
    ...(skills !== undefined && { skills }),
    ...(languages !== undefined && { languages }),
    ...(certifications !== undefined && { certifications }),
    ...(internships !== undefined && { internships }),
  });

  await logAudit(req, AuditAction.UPDATE, 'cv_extracted_data', extractedData.id);

  res.json({
    success: true,
    message: 'CV information updated successfully',
    data: extractedData.toJSON(),
  });
}

/**
 * List all user's CVs (completed and archived)
 */
export async function listUserCVs(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  const cvs = await CV.findAll({
    where: {
      userId: req.user.userId,
      status: [CVStatus.COMPLETED, CVStatus.ARCHIVED],
    },
    include: [{
      model: CVExtractedData,
      as: 'extractedData',
      required: false,
      attributes: ['id', 'fullName', 'email', 'phone', 'location'],
    }],
    order: [['isDefault', 'DESC'], ['createdAt', 'DESC']],
    attributes: ['id', 'originalFileName', 'status', 'isDefault', 'fileSize', 'createdAt', 'updatedAt'],
  });

  const formattedCVs = cvs.map(cv => ({
    id: cv.id,
    originalFileName: cv.originalFileName,
    status: cv.status,
    isDefault: cv.isDefault,
    fileSize: cv.fileSize,
    createdAt: cv.createdAt,
    updatedAt: cv.updatedAt,
    extractedData: (cv as any).extractedData ? {
      fullName: (cv as any).extractedData.fullName,
      email: (cv as any).extractedData.email,
      phone: (cv as any).extractedData.phone,
      location: (cv as any).extractedData.location,
    } : null,
  }));

  res.json({
    success: true,
    data: formattedCVs,
  });
}

/**
 * Set a CV as default
 */
export async function setDefaultCV(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  const { cvId } = req.params;

  // Get the CV to set as default
  const cv = await CV.findOne({
    where: {
      id: cvId,
      userId: req.user.userId,
      status: [CVStatus.COMPLETED, CVStatus.ARCHIVED],
    },
  });

  if (!cv) {
    throw new NotFoundError('CV not found');
  }

  // Unset all other CVs as default
  await CV.update(
    { isDefault: false },
    { where: { userId: req.user.userId } }
  );

  // Set this CV as default
  await cv.update({ isDefault: true });
  await logAudit(req, AuditAction.UPDATE, 'cv', cv.id, { action: 'set_default' });

  res.json({
    success: true,
    message: 'CV set as default',
    data: cv.toJSON(),
  });
}

/**
 * Delete a CV
 */
export async function deleteCV(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  const { cvId } = req.params;

  // Get the CV to delete
  const cv = await CV.findOne({
    where: {
      id: cvId,
      userId: req.user.userId,
      status: [CVStatus.COMPLETED, CVStatus.ARCHIVED],
    },
  });

  if (!cv) {
    throw new NotFoundError('CV not found');
  }

  // If this is the default CV, set another one as default if available
  if (cv.isDefault) {
    const nextCV = await CV.findOne({
      where: {
        userId: req.user.userId,
        id: { [Op.ne]: cvId },
        status: [CVStatus.COMPLETED, CVStatus.ARCHIVED],
      },
      order: [['createdAt', 'DESC']],
    });

    if (nextCV) {
      await nextCV.update({ isDefault: true });
    }
  }

  // Delete the CV and its extracted data
  const extractedData = await CVExtractedData.findOne({
    where: { cvId: cv.id },
  });

  if (extractedData) {
    await extractedData.destroy();
  }

  await cv.destroy();
  await logAudit(req, AuditAction.DELETE, 'cv', cv.id);

  res.json({
    success: true,
    message: 'CV deleted successfully',
  });
}

/**
 * Get roles that a user can create/assign
 */
function getAllowedRolesToCreate(actorRole: UserRole): UserRole[] {
  switch (actorRole) {
    case UserRole.SUPERADMIN:
      return [UserRole.ADMIN, UserRole.MODERATOR, UserRole.USER];
    case UserRole.ADMIN:
      return [UserRole.MODERATOR, UserRole.USER];
    case UserRole.MODERATOR:
      return [UserRole.USER];
    default:
      return [];
  }
}