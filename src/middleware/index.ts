// Authentication & Authorization
export { 
  authenticate, 
  optionalAuth, 
  requireActiveAccount,
  generateTokens,
  verifyRefreshToken,
  parseExpiryToMs,
} from './auth.js';

export {
  authorize,
  requireSuperAdmin,
  requireAdmin,
  requireModerator,
  requireUser,
  requireOwnerOrAdmin,
  canModifyUser,
  requireHigherRole,
} from './authorize.js';

// Error Handling
export {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
} from './errorHandler.js';

// Validation
export {
  validate,
  commonSchemas,
  authSchemas,
  userSchemas,
  cvSchemas,
  cvListSchemas,
  llmConfigSchemas,
} from './validate.js';

// File Upload
export {
  uploadCV,
  uploadMultipleCVs,
  uploadAvatar,
  cleanupUploadedFile,
  getDocumentType,
} from './upload.js';

// Audit Logging
export {
  logAudit,
  audit,
  logAuthEvent,
  logSettingsChange,
} from './audit.js';