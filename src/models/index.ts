// Export all models
export { User, UserRole, UserStatus, type UserAttributes, type UserCreationAttributes } from './User.js';
export { RefreshToken, type RefreshTokenAttributes, type RefreshTokenCreationAttributes } from './RefreshToken.js';
export { CV, CVStatus, DocumentType, type CVAttributes, type CVCreationAttributes } from './CV.js';
export { 
  CVExtractedData, 
  type CVExtractedDataAttributes, 
  type CVExtractedDataCreationAttributes,
  type Education,
  type Experience,
  type Language,
  type Skills,
  type Certification,
  type Internship,
} from './CVExtractedData.js';
export { 
  CVList, 
  CVListItem, 
  CVListShare,
  type CVListAttributes,
  type CVListCreationAttributes,
  type CVListItemAttributes,
  type CVListItemCreationAttributes,
  type CVListShareAttributes,
  type CVListShareCreationAttributes,
} from './CVList.js';
export { 
  LLMConfiguration, 
  LLMProvider, 
  ExtractionStrictness,
  type LLMConfigurationAttributes, 
  type LLMConfigurationCreationAttributes 
} from './LLMConfiguration.js';
export { AuditLog, AuditAction, type AuditLogAttributes, type AuditLogCreationAttributes } from './AuditLog.js';
export { SystemSettings, type SystemSettingsAttributes, type SystemSettingsCreationAttributes } from './SystemSettings.js';

// Re-export database connection utilities
export { sequelize, connectDatabase, syncDatabase, closeDatabase } from '../config/database.js';