import { Response } from 'express';
import { Op } from 'sequelize';
import { CV, CVStatus, CVExtractedData, LLMConfiguration, DocumentType, SystemSettings, User, CVList, CVListItem, CVListShare, UserRole } from '../models/index.js';
import { AuthenticatedRequest } from '../types/index.js';
import { NotFoundError, ValidationError, ForbiddenError } from '../middleware/errorHandler.js';
import { getDocumentType, cleanupUploadedFile } from '../middleware/upload.js';
import { logAudit } from '../middleware/audit.js';
import { AuditAction } from '../models/AuditLog.js';
import { getCVProcessorService } from '../services/cvProcessor.js';
import { getGoogleDriveService } from '../services/storage/googleDrive.js';
import { logger } from '../utils/logger.js';

const cvProcessor = getCVProcessorService();
const driveService = getGoogleDriveService();

/**
 * Transform CVExtractedData to match frontend expectations
 * Robust to handle LLM extraction failures and missing data
 */
function transformExtractedData(extractedData: any): any {
  if (!extractedData) {
    logger.debug(`[transformExtractedData] No extracted data to transform`);
    return null;
  }

  logger.debug(`[transformExtractedData] Transforming data for CV:`, {
    fullName: extractedData.fullName || 'missing',
    email: extractedData.email || 'missing',
    hasEducation: Array.isArray(extractedData.education) && extractedData.education.length > 0,
    hasExperience: Array.isArray(extractedData.experience) && extractedData.experience.length > 0,
    hasSkills: extractedData.skills && Object.keys(extractedData.skills).length > 0,
  });

  const transformed = {
    id: extractedData.id,
    cvId: extractedData.cvId,
    personalInfo: {
      fullName: extractedData.fullName || 'Name not extracted',
      email: extractedData.email || '',
      phone: extractedData.phone || '',
      address: extractedData.location || '',
      city: extractedData.city || '',
      country: extractedData.country || '',
    },
    age: extractedData.age ?? null,
    gender: extractedData.gender || '',
    experience: extractedData.experience || [],
    education: extractedData.education || [],
    // Preserve skills as categorized JSON (technical, soft, tools)
    skills: extractedData.skills || { technical: [], soft: [], tools: [] },
    languages: extractedData.languages || [],
    certifications: extractedData.certifications || [],
    internships: extractedData.internships || [],
    totalExperienceYears: extractedData.totalExperienceYears || 0,
    seniorityLevel: extractedData.seniorityLevel || 'Junior',
    industry: extractedData.industry || '',
    keywords: extractedData.keywords || [],
    rawText: extractedData.rawText,
    createdAt: extractedData.createdAt,
    updatedAt: extractedData.updatedAt,
  };

  // Compute skills count across categories for logging
  const skillsCount = Array.isArray((transformed as any).skills)
    ? ((transformed as any).skills as any[]).length
    : ['technical','soft','tools'].reduce((sum, key) => {
        const arr = ((transformed as any).skills?.[key] || []) as any[];
        return sum + (Array.isArray(arr) ? arr.length : 0);
      }, 0);

  logger.debug(`[transformExtractedData] Transformation complete, skills count: ${skillsCount}`);
  return transformed;
}

/**
 * Flatten skills from categorized object to array
 */
function flattenSkills(skills: any): string[] {
  if (!skills) return [];
  return [
    ...(skills.technical || []),
    ...(skills.soft || []),
    ...(skills.tools || []),
  ];
}

/**
 * Upload and process a CV
 * Allows multiple CVs, with only one marked as default
 */
export async function uploadCV(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.file) {
    throw new ValidationError('No file uploaded');
  }

  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  const file = req.file;
  const documentType = getDocumentType(file.mimetype);

  // Check if user already has a default CV
  const defaultCV = await CV.findOne({
    where: {
      userId: req.user.userId,
      isDefault: true,
    },
  });

  // Create new CV record
  // Always mark new uploads as not default initially
  // After successful processing, it will be set as default
  const isDefault = false;
  
  const cv = await CV.create({
    userId: req.user.userId,
    originalFileName: file.originalname,
    documentType: documentType as DocumentType,
    fileSize: file.size,
    status: CVStatus.PENDING,
    isDefault: isDefault,
  });

  await logAudit(req, AuditAction.UPLOAD, 'cv', cv.id);

  // Check if LLM processing is enabled
  const llmEnabledSetting = await SystemSettings.getSetting<boolean>('llmEnabled', true);
  logger.info(`LLM Processing enabled: ${llmEnabledSetting}`);

  // Get LLM configuration only if LLM processing is enabled
  let llmConfig: LLMConfiguration | null = null;
  if (llmEnabledSetting) {
    llmConfig = await LLMConfiguration.findOne({
      where: { isDefault: true, isActive: true },
    });
  }

  // Capture the response data before starting async processing
  const responseData = {
    id: cv.id,
    status: cv.status,
    originalFileName: cv.originalFileName,
  };

  // Process CV asynchronously
  cvProcessor.processCV(cv, file.path, llmConfig || undefined, llmEnabledSetting)
    .then(async (result) => {
      if (!result.success) {
        logger.error(`CV processing failed: ${cv.id}`, result.error);
      } else {
        // After successful processing, set this CV as default (unset previous default)
        try {
          // Unset previous default CV
          await CV.update(
            { isDefault: false },
            { where: { userId: req.user.userId, isDefault: true, id: { [Op.ne]: cv.id } } }
          );
          
          // Set new CV as default
          await cv.update({ isDefault: true });
          logger.info(`[uploadCV] New CV ${cv.id} set as default for user ${req.user.userId}`);
        } catch (error) {
          logger.error(`Failed to set CV as default: ${cv.id}`, error);
        }
      }
    })
    .catch(error => {
      logger.error(`CV processing error: ${cv.id}`, error);
    });

  res.status(202).json({
    success: true,
    message: 'CV uploaded and queued for processing',
    data: responseData,
  });
}

/**
 * List CVs (with pagination and filtering)
 */
export async function listCVs(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  const {
    page = 1,
    limit = 20,
    status,
    search,
    skills,
    minExperience,
    maxExperience,
    seniorityLevel,
    industry,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const pageNum = Number(page);
  const limitNum = Number(limit);
  const offset = (pageNum - 1) * limitNum;

  // Build where clause for CVs
  const cvWhere: any = {};

  // Non-admin users only see their own CVs
  if (req.user.role === 'USER') {
    cvWhere.userId = req.user.userId;
  }

  // Only show default CV
  cvWhere.isDefault = true;

  // Default to showing only COMPLETED CVs unless explicitly requesting other statuses
  if (status) {
    // Only allow specific status filters
    if ([CVStatus.COMPLETED, CVStatus.PROCESSING, CVStatus.PENDING, CVStatus.FAILED].includes(status as CVStatus)) {
      cvWhere.status = status;
      logger.debug(`[listCVs] Filtering by status: ${status}`);
    } else {
      // Invalid status, show all CVs
      logger.debug(`[listCVs] Invalid status filter, showing all CVs`);
    }
  } else {
    // Default: Show all CVs regardless of processing status for robustness
    // This ensures CVs are visible even if LLM extraction fails or is still processing
    logger.debug(`[listCVs] No status filter provided, showing all CVs`);
  }

  // Build include with extracted data filters
  const extractedDataWhere: any = {};

  if (search) {
    extractedDataWhere[Op.or] = [
      { fullName: { [Op.like]: `%${search}%` } },
      { email: { [Op.like]: `%${search}%` } },
      { rawText: { [Op.like]: `%${search}%` } },
    ];
  }

  if (skills) {
    const skillsArray = (skills as string).split(',').map(s => s.trim());
    // For MySQL JSON, use LIKE with JSON search
    extractedDataWhere[Op.or] = skillsArray.map(skill => ({
      [Op.or]: [
        { keywords: { [Op.like]: `%${skill}%` } },
        { rawText: { [Op.like]: `%${skill}%` } },
      ]
    }));
  }

  if (minExperience || maxExperience) {
    extractedDataWhere.totalExperienceYears = {};
    if (minExperience) {
      extractedDataWhere.totalExperienceYears[Op.gte] = Number(minExperience);
    }
    if (maxExperience) {
      extractedDataWhere.totalExperienceYears[Op.lte] = Number(maxExperience);
    }
  }

  if (seniorityLevel) {
    extractedDataWhere.seniorityLevel = seniorityLevel;
  }

  if (industry) {
    extractedDataWhere.industry = { [Op.like]: `%${industry}%` };
  }

  const hasExtractedFilters = Object.keys(extractedDataWhere).length > 0;

  logger.debug(`[listCVs] Query params - page: ${pageNum}, limit: ${limitNum}, search: ${search}, status: ${status}`);
  logger.debug(`[listCVs] User ID: ${req.user.userId}, User role: ${req.user.role}`);
  logger.debug(`[listCVs] Has extracted filters: ${hasExtractedFilters}`);
  logger.debug(`[listCVs] CV Where clause:`, JSON.stringify(cvWhere));
  logger.debug(`[listCVs] ExtractedData Where clause:`, JSON.stringify(extractedDataWhere));

  // Check total CVs in database regardless of filters
  const totalInDb = await CV.count();
  const totalByStatus = await CV.count({ group: 'status' });
  logger.debug(`[listCVs] Total CVs in database: ${totalInDb}`);
  logger.debug(`[listCVs] CVs by status:`, totalByStatus);

  const { rows: cvs, count: total } = await CV.findAndCountAll({
    where: cvWhere,
    include: [
      {
        model: CVExtractedData,
        as: 'extractedData',
        required: false, // LEFT JOIN to include CVs without extraction (failed/processing)
        where: hasExtractedFilters ? extractedDataWhere : undefined,
      },
      {
        model: User,
        as: 'user',
        required: false, // LEFT JOIN to include CVs from deleted users
        attributes: ['id', 'avatar', 'firstName', 'lastName'], // Only fetch needed fields
      }
    ],
    order: [[sortBy as string, sortOrder.toString().toUpperCase()]],
    limit: limitNum,
    offset,
    distinct: true,
  });

  logger.debug(`[listCVs] Query returned ${cvs.length} CVs out of ${total} total`);
  
  // Log status of returned CVs
  if (cvs.length > 0) {
    const statusBreakdown = cvs.reduce((acc: any, cv: any) => {
      acc[cv.status] = (acc[cv.status] || 0) + 1;
      return acc;
    }, {});
    logger.debug(`[listCVs] Returned CVs by status:`, statusBreakdown);
    
    const firstCVData = cvs[0] as any;
    logger.debug(`[listCVs] First CV sample:`, {
      id: firstCVData.id?.substring(0, 8) || 'no-id',
      status: firstCVData.status || 'no-status',
      originalFileName: firstCVData.originalFileName || 'no-filename',
      hasExtractedData: !!firstCVData.extractedData,
      processingError: firstCVData.processingError ? firstCVData.processingError.substring(0, 150) + '...' : 'none',
    });
  }
  
  if (cvs.length === 0) {
    logger.warn(`[listCVs] No CVs found! Checking database...`);
    const allCVs = await CV.findAll({ attributes: ['id', 'status', 'userId'], limit: 10 });
    logger.warn(`[listCVs] Sample CVs in DB (${allCVs.length} shown):`, allCVs.map((cv: any) => ({
      id: cv.id.substring(0, 8),
      status: cv.status,
      userId: cv.userId ? cv.userId.substring(0, 8) : 'null',
      matchesUser: req.user ? cv.userId === req.user.userId : false,
      matchesRole: req.user ? (req.user.role !== 'USER' || cv.userId === req.user.userId) : false,
    })));
    
    // Check status distribution
    const statusCount = await CV.findAll({
      attributes: [
        'status',
        [CV.sequelize!.fn('COUNT', CV.sequelize!.col('id')), 'count']
      ],
      group: ['status'],
      raw: true
    });
    logger.warn(`[listCVs] Status distribution:`, statusCount);
  }
  
  logger.debug(`[listCVs] First CV extracted data exists: ${(cvs[0] as any)?.extractedData ? 'yes' : 'no'}`);
  
  // Log all CV statuses
  const statusSummary = cvs.reduce((acc: any, cv: any) => {
    const status = cv.status;
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  logger.debug(`[listCVs] CV Status Summary:`, statusSummary);

  // Transform extracted data for frontend
  const transformedCVs = cvs.map((cv: any) => {
    const cvJson = cv.toJSON();
    const extractedDataToTransform = (cv as any).extractedData;
    const userAvatarUrl = (cv as any).user?.avatar; // Get user avatar if available
    
    return {
      ...cvJson,
      // Include user data in metadata for photo fallback chain
      metadata: {
        ...cvJson.metadata,
        user: (cv as any).user ? {
          avatar: userAvatarUrl,
          firstName: (cv as any).user.firstName,
          lastName: (cv as any).user.lastName,
        } : undefined,
      },
      extractedData: transformExtractedData(extractedDataToTransform) || {
        // Fallback data when LLM extraction failed or is pending
        personalInfo: {
          fullName: cvJson.originalFileName?.replace(/\.[^/.]+$/, '') || 'Processing...',
          email: '',
          phone: '',
          address: '',
          city: '',
          country: '',
        },
        experience: [],
        education: [],
        skills: [],
        languages: [],
        certifications: [],
        internships: [],
        totalExperienceYears: 0,
        seniorityLevel: 'Junior',
        industry: '',
        keywords: [],
      },
    };
  });

  logger.debug(`[listCVs] Transformed ${transformedCVs.length} CVs`);
  if (transformedCVs.length > 0) {
    const firstTransformed = transformedCVs[0];
    logger.debug(`[listCVs] First transformed CV:`, {
      id: firstTransformed.id?.substring(0, 8) || 'no-id',
      status: firstTransformed.status || 'no-status',
      originalFileName: firstTransformed.originalFileName || 'no-filename',
      hasExtractedData: !!firstTransformed.extractedData,
      extractedDataFullName: firstTransformed.extractedData?.personalInfo?.fullName || 'no-name',
      extractedDataSkillsCount: firstTransformed.extractedData?.skills?.length || 0,
    });
  }

  res.json({
    success: true,
    data: transformedCVs,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      hasMore: offset + transformedCVs.length < total,
    },
  });

  logger.debug(`[listCVs] Response sent with ${transformedCVs.length} CVs`);
}

/**
 * Get a single CV by ID
 */
export async function getCV(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const cv = await CV.findByPk(id, {
    include: [
      { model: CVExtractedData, as: 'extractedData' },
      {
        model: User,
        as: 'user',
        required: false,
        attributes: ['id', 'avatar', 'firstName', 'lastName'],
      }
    ],
  });

  if (!cv) {
    throw new NotFoundError('CV');
  }

  // Check access permissions
  if (req.user?.role === 'USER' && cv.userId !== req.user.userId) {
    // Check if CV has been shared with this user
    const isSharedWithUser = await CVListShare.findOne({
      where: {
        sharedWith: req.user.userId,
        [Op.or]: [
          { expiresAt: null },
          { expiresAt: { [Op.gt]: new Date() } },
        ],
      },
      include: [
        {
          model: CVList,
          as: 'list',
          required: true,
          include: [
            {
              model: CVListItem,
              as: 'items',
              required: true,
              where: { cvId: id },
            }
          ]
        }
      ]
    });

    if (!isSharedWithUser) {
      throw new ForbiddenError('You can only access your own CVs or CVs shared with you');
    }
  }

  await logAudit(req, AuditAction.READ, 'cv', cv.id);

  const cvJson = cv.toJSON() as any;
  const userAvatarUrl = (cv as any).user?.avatar;

  res.json({
    success: true,
    data: {
      ...cvJson,
      // Include user data in metadata for photo fallback chain
      metadata: {
        ...cvJson.metadata,
        user: (cv as any).user ? {
          avatar: userAvatarUrl,
          firstName: (cv as any).user.firstName,
          lastName: (cv as any).user.lastName,
        } : undefined,
      },
      extractedData: transformExtractedData((cv as any).extractedData),
    },
  });
}

/**
 * Get CV extracted data by ID
 */
export async function getCVExtractedData(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const cv = await CV.findByPk(id, {
    include: [{ model: CVExtractedData, as: 'extractedData' }],
  });

  if (!cv) {
    throw new NotFoundError('CV');
  }

  // Check access permissions
  if (req.user?.role === 'USER' && cv.userId !== req.user.userId) {
    throw new ForbiddenError('You can only access your own CVs');
  }

  await logAudit(req, AuditAction.READ, 'cv', cv.id);

  const transformed = transformExtractedData((cv as any).extractedData);
  
  logger.info('[getCVExtractedData] RAW EXTRACTED DATA FROM DB:');
  logger.info(JSON.stringify((cv as any).extractedData, null, 2));
  
  logger.info('[getCVExtractedData] TRANSFORMED DATA TO SEND TO MOBILE:');
  logger.info(JSON.stringify(transformed, null, 2));

  res.json({
    success: true,
    data: transformed,
  });
}

/**
 * Get CVs shared BY the current user (sharing history)
 * Shows which CVs the user has shared with consultants
 */
export async function getSharedByMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  // Find all lists created by this user with their shares
  const myLists = await CVList.findAll({
    where: { userId: req.user.userId },
    include: [
      {
        model: CVListItem,
        as: 'items',
        required: true,
        include: [
          {
            model: CV,
            as: 'cv',
            required: true,
            include: [
              {
                model: CVExtractedData,
                as: 'extractedData',
                required: false,
              },
              {
                model: User,
                as: 'user',
                required: false,
                attributes: ['id', 'avatar', 'firstName', 'lastName'],
              },
            ],
          }
        ]
      },
      {
        model: CVListShare,
        as: 'shares',
        required: true,
        where: {
          [Op.or]: [
            { expiresAt: null },
            { expiresAt: { [Op.gt]: new Date() } },
          ],
        },
        include: [
          {
            model: User,
            as: 'sharedWithUser',
            attributes: ['id', 'firstName', 'lastName', 'email'],
          }
        ]
      }
    ],
    order: [['createdAt', 'DESC']],
  });

  if (!myLists.length) {
    res.json({ success: true, data: [] });
    return;
  }

  // Transform into sharing history with consultant grouping
  const sharingHistory: any[] = [];

  for (const list of myLists) {
    const listJson = list.toJSON() as any;
    
    for (const share of listJson.shares || []) {
      for (const item of listJson.items || []) {
        const cv = item.cv;
        if (!cv) continue;

        const transformedExtracted = transformExtractedData(cv.extractedData);

        const metadata = {
          ...cv.metadata,
          rawData: {
            ...cv.metadata?.rawData,
            user: cv.user
              ? {
                  id: cv.user.id,
                  avatar: cv.user.avatar,
                  firstName: cv.user.firstName,
                  lastName: cv.user.lastName,
                }
              : undefined,
            // Add sharing metadata
            sharedWith: share.sharedWithUser
              ? {
                  id: share.sharedWithUser.id,
                  firstName: share.sharedWithUser.firstName,
                  lastName: share.sharedWithUser.lastName,
                  email: share.sharedWithUser.email,
                }
              : undefined,
            sharedAt: share.createdAt,
            listName: listJson.name,
            listDescription: listJson.description,
          },
        };

        sharingHistory.push({
          ...cv,
          metadata,
          extractedData: transformedExtracted,
        });
      }
    }
  }

  res.json({
    success: true,
    data: sharingHistory,
  });
}

/**
 * Get CV processing status
 */
export async function getCVStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const cv = await CV.findByPk(id, {
    attributes: ['id', 'status', 'processingStartedAt', 'processingCompletedAt', 'processingError', 'userId'],
  });

  if (!cv) {
    throw new NotFoundError('CV');
  }

  // Check access permissions
  if (req.user?.role === 'USER' && cv.userId !== req.user.userId) {
    throw new ForbiddenError('You can only access your own CVs');
  }

  res.json({
    success: true,
    data: {
      id: cv.id,
      status: cv.status,
      processingStartedAt: cv.processingStartedAt,
      processingCompletedAt: cv.processingCompletedAt,
      processingError: cv.processingError,
    },
  });
}

/**
 * Reprocess a failed CV
 */
export async function reprocessCV(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const cv = await CV.findByPk(id);
  if (!cv) {
    throw new NotFoundError('CV');
  }

  if (cv.status !== CVStatus.FAILED) {
    throw new ValidationError('Only failed CVs can be reprocessed');
  }

  // Check if LLM processing is enabled
  const llmEnabledSetting = await SystemSettings.getSetting<boolean>('llmEnabled', true);
  logger.info(`LLM Processing enabled (reprocess): ${llmEnabledSetting}`);

  // Get LLM configuration only if LLM processing is enabled
  let llmConfig: LLMConfiguration | null = null;
  if (llmEnabledSetting) {
    llmConfig = await LLMConfiguration.findOne({
      where: { isDefault: true, isActive: true },
    });
  }

  // Reprocess asynchronously
  cvProcessor.reprocessCV(id, llmConfig || undefined, llmEnabledSetting)
    .then(result => {
      if (!result.success) {
        logger.error(`CV reprocessing failed: ${id}`, result.error);
      }
    })
    .catch(error => {
      logger.error(`CV reprocessing error: ${id}`, error);
    });

  await logAudit(req, AuditAction.UPDATE, 'cv', cv.id, { reprocessed: true });

  res.json({
    success: true,
    message: 'CV queued for reprocessing',
    data: {
      id: cv.id,
      status: CVStatus.PENDING,
    },
  });
}

/**
 * Delete a CV
 */
export async function deleteCV(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const cv = await CV.findByPk(id);
  if (!cv) {
    throw new NotFoundError('CV');
  }

  // Check access permissions
  if (req.user?.role === 'USER' && cv.userId !== req.user.userId) {
    throw new ForbiddenError('You can only delete your own CVs');
  }

  // Delete from Google Drive
  if (cv.googleDriveFileId && driveService.isAvailable()) {
    try {
      await driveService.deleteFile(cv.googleDriveFileId);
    } catch (error) {
      logger.error('Failed to delete CV from Google Drive:', error);
    }
  }

  await logAudit(req, AuditAction.DELETE, 'cv', cv.id);

  await cv.destroy();

  res.json({
    success: true,
    message: 'CV deleted successfully',
  });
}

/**
 * Download CV file
 */
export async function downloadCV(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const cv = await CV.findByPk(id);
  if (!cv) {
    throw new NotFoundError('CV');
  }

  // Check access permissions
  if (req.user?.role === 'USER' && cv.userId !== req.user.userId) {
    throw new ForbiddenError('You can only download your own CVs');
  }

  if (!cv.googleDriveFileId || !driveService.isAvailable()) {
    throw new NotFoundError('CV file not available');
  }

  const fileBuffer = await driveService.downloadFile(cv.googleDriveFileId);

  await logAudit(req, AuditAction.DOWNLOAD, 'cv', cv.id);

  // Set appropriate headers
  res.setHeader('Content-Type', cv.googleDriveMimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${cv.originalFileName}"`);
  res.setHeader('Content-Length', fileBuffer.length);

  res.send(fileBuffer);
}

/**
 * Get CV statistics (admin only)
 */
export async function getCVStatistics(req: AuthenticatedRequest, res: Response): Promise<void> {
  const totalCVs = await CV.count();
  const statusCounts = await CV.findAll({
    attributes: [
      'status',
      [CV.sequelize!.fn('COUNT', CV.sequelize!.col('id')), 'count'],
    ],
    group: ['status'],
    raw: true,
  });

  const stats = {
    total: totalCVs,
    byStatus: statusCounts.reduce((acc: any, item: any) => {
      acc[item.status] = parseInt(item.count, 10);
      return acc;
    }, {}),
  };

  res.json({
    success: true,
    data: stats,
  });
}

/**
 * Share a set of CVs with a consultant (admin/moderator/superadmin)
 */
export async function shareCVsWithConsultant(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  const { consultantId, cvIds, name, description, expiresAt } = req.body as {
    consultantId?: string;
    cvIds?: string[];
    name?: string;
    description?: string;
    expiresAt?: string;
  };

  if (!consultantId) {
    throw new ValidationError('consultantId is required');
  }
  if (!Array.isArray(cvIds) || cvIds.length === 0) {
    throw new ValidationError('cvIds must be a non-empty array');
  }

  // Ensure consultant exists
  const consultant = await User.findByPk(consultantId);
  if (!consultant) {
    throw new NotFoundError('Consultant user');
  }

  // Create a list to group shared CVs
  const list = await CVList.create({
    name: name || `Consultant share - ${new Date().toISOString()}`,
    description: description || `Shared by ${req.user.userId}`,
    userId: req.user.userId,
    isPublic: false,
  });

  // Add CVs to the list (ignore duplicates)
  const uniqueCvIds = Array.from(new Set(cvIds));
  await CVListItem.bulkCreate(
    uniqueCvIds.map((cvId) => ({ listId: list.id, cvId })),
    { ignoreDuplicates: true }
  );

  // Share the list with the consultant
  const share = await CVListShare.create({
    listId: list.id,
    sharedWith: consultantId,
    canEdit: false,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
  });

  const shareBaseUrl = process.env.APP_BASE_URL || 'https://app.cvtech.local';
  const shareUrl = `${shareBaseUrl.replace(/\/$/, '')}/consultant/${list.id}`;

  // Optional QR code generation (graceful fallback if library is missing)
  let qrCodeDataUrl: string | undefined;
  try {
    const QRCode = await import('qrcode');
    qrCodeDataUrl = await QRCode.toDataURL(shareUrl);
  } catch (err) {
    logger.warn('QR code generation skipped (qrcode package not installed):', err);
  }

  await logAudit(req, AuditAction.CREATE, 'cv_list_share', share.id, {
    consultantId,
    cvCount: uniqueCvIds.length,
  });

  res.json({
    success: true,
    message: 'CVs shared with consultant',
    data: {
      listId: list.id,
      sharedWith: consultantId,
      cvCount: uniqueCvIds.length,
      shareUrl,
      qrCodeDataUrl,
    },
  });
}

/**
 * Get CVs shared with the authenticated user (consultant view)
 */
export async function getSharedWithMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }

  // Fetch shares targeted to this user (not expired)
  const shares = await CVListShare.findAll({
    where: {
      sharedWith: req.user.userId,
      [Op.or]: [
        { expiresAt: null },
        { expiresAt: { [Op.gt]: new Date() } },
      ],
    },
    raw: true,
  });

  if (!shares.length) {
    res.json({ success: true, data: [] });
    return;
  }

  const listIds = Array.from(new Set(shares.map((s) => s.listId)));
  const items = await CVListItem.findAll({
    where: { listId: listIds },
    raw: true,
  });

  const cvIds = Array.from(new Set(items.map((i) => i.cvId)));
  if (!cvIds.length) {
    res.json({ success: true, data: [] });
    return;
  }

  const cvs = await CV.findAll({
    where: { id: cvIds },
    include: [
      {
        model: CVExtractedData,
        as: 'extractedData',
        required: false,
      },
      {
        model: User,
        as: 'user',
        required: false,
        attributes: ['id', 'avatar', 'firstName', 'lastName'],
      },
    ],
    order: [['createdAt', 'DESC']],
  });

  const transformed = cvs.map((cv: any) => {
    const cvJson = cv.toJSON();

    // Transform extracted data for frontend
    const transformedExtracted = transformExtractedData(cvJson.extractedData);

    // Attach user info into metadata for photo priority
    const metadata = {
      ...cvJson.metadata,
      rawData: {
        ...cvJson.metadata?.rawData,
        user: cvJson.user
          ? {
              id: cvJson.user.id,
              avatar: cvJson.user.avatar,
              firstName: cvJson.user.firstName,
              lastName: cvJson.user.lastName,
            }
          : undefined,
      },
    };

    return {
      ...cvJson,
      metadata,
      extractedData: transformedExtracted,
    };
  });

  res.json({
    success: true,
    data: transformed,
  });
}