import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database.js';
import { User } from './User.js';

export enum CVStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  ARCHIVED = 'ARCHIVED',
}

export enum DocumentType {
  PDF = 'PDF',
  DOCX = 'DOCX',
  IMAGE = 'IMAGE',
}

export interface CVAttributes {
  id: string;
  userId: string;
  
  // Document Storage
  originalFileName: string;
  documentType: DocumentType;
  fileSize: number;
  googleDriveFileId?: string;
  googleDriveMimeType?: string;
  fileChecksum?: string;
  
  // Processing Status
  status: CVStatus;
  isDefault: boolean;
  processingStartedAt?: Date;
  processingCompletedAt?: Date;
  processingError?: string;
  
  // Photo
  photoUrl?: string;
  photoPublicId?: string;
  photoWidth?: number;
  photoHeight?: number;
  
  // AI Summary
  aiSummary?: string;
  
  // Metadata
  confidenceScore?: number;
  llmProvider?: string;
  llmModel?: string;
  extractionVersion?: string;
  
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CVCreationAttributes extends Optional<CVAttributes, 
  'id' | 'status' | 'isDefault' | 'googleDriveFileId' | 'googleDriveMimeType' | 'fileChecksum' |
  'processingStartedAt' | 'processingCompletedAt' | 'processingError' |
  'photoUrl' | 'photoPublicId' | 'photoWidth' | 'photoHeight' |
  'aiSummary' | 'confidenceScore' | 'llmProvider' | 'llmModel' | 'extractionVersion' |
  'createdAt' | 'updatedAt'
> {}

export class CV extends Model<CVAttributes, CVCreationAttributes> implements CVAttributes {
  declare id: string;
  declare userId: string;
  declare originalFileName: string;
  declare documentType: DocumentType;
  declare fileSize: number;
  declare googleDriveFileId?: string;
  declare googleDriveMimeType?: string;
  declare fileChecksum?: string;
  declare status: CVStatus;
  declare isDefault: boolean;
  declare processingStartedAt?: Date;
  declare processingCompletedAt?: Date;
  declare processingError?: string;
  declare photoUrl?: string;
  declare photoPublicId?: string;
  declare photoWidth?: number;
  declare photoHeight?: number;
  declare aiSummary?: string;
  declare confidenceScore?: number;
  declare llmProvider?: string;
  declare llmModel?: string;
  declare extractionVersion?: string;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  isPending(): boolean {
    return this.status === CVStatus.PENDING;
  }

  isProcessing(): boolean {
    return this.status === CVStatus.PROCESSING;
  }

  isCompleted(): boolean {
    return this.status === CVStatus.COMPLETED;
  }

  isFailed(): boolean {
    return this.status === CVStatus.FAILED;
  }

  hasPhoto(): boolean {
    return !!this.photoUrl;
  }
}

CV.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'user_id',
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    originalFileName: {
      type: DataTypes.STRING(500),
      allowNull: false,
      field: 'original_file_name',
    },
    documentType: {
      type: DataTypes.ENUM(...Object.values(DocumentType)),
      allowNull: false,
      field: 'document_type',
    },
    fileSize: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'file_size',
    },
    googleDriveFileId: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'google_drive_file_id',
    },
    googleDriveMimeType: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'google_drive_mime_type',
    },
    fileChecksum: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'file_checksum',
    },
    status: {
      type: DataTypes.ENUM(...Object.values(CVStatus)),
      defaultValue: CVStatus.PENDING,
      allowNull: false,
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      field: 'is_default',
    },
    processingStartedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'processing_started_at',
    },
    processingCompletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'processing_completed_at',
    },
    processingError: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'processing_error',
    },
    photoUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'photo_url',
    },
    photoPublicId: {
      type: DataTypes.STRING(200),
      allowNull: true,
      field: 'photo_public_id',
    },
    photoWidth: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'photo_width',
    },
    photoHeight: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'photo_height',
    },
    aiSummary: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'ai_summary',
    },
    confidenceScore: {
      type: DataTypes.FLOAT,
      allowNull: true,
      field: 'confidence_score',
    },
    llmProvider: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: 'llm_provider',
    },
    llmModel: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'llm_model',
    },
    extractionVersion: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: 'extraction_version',
    },
  },
  {
    sequelize,
    tableName: 'cvs',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['status'] },
      { fields: ['created_at'] },
      { fields: ['google_drive_file_id'] },
    ],
  }
);

// Associations
User.hasMany(CV, { foreignKey: 'userId', as: 'cvs' });
CV.belongsTo(User, { foreignKey: 'userId', as: 'user' });