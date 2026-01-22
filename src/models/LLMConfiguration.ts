import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database.js';

export enum LLMProvider {
  GEMINI = 'GEMINI',
  OPENAI = 'OPENAI',
  GROK = 'GROK',
}

export enum ExtractionStrictness {
  STRICT = 'strict',
  MODERATE = 'moderate',
  LENIENT = 'lenient',
}

export interface LLMConfigurationAttributes {
  id: string;
  name: string;
  provider: LLMProvider;
  model: string;
  isDefault: boolean;
  isActive: boolean;
  
  // Credentials
  apiKey?: string;
  
  // Model Parameters
  temperature: number;
  topP: number;
  
  // Extraction Settings
  extractionStrictness: ExtractionStrictness;
  
  // Custom Prompts
  extractionPrompt?: string;
  summaryPrompt?: string;
  
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LLMConfigurationCreationAttributes extends Optional<LLMConfigurationAttributes,
  'id' | 'isDefault' | 'isActive' | 'temperature' | 'topP' |
  'extractionStrictness' | 'extractionPrompt' | 'summaryPrompt' | 'createdAt' | 'updatedAt'
> {}

export class LLMConfiguration extends Model<LLMConfigurationAttributes, LLMConfigurationCreationAttributes> implements LLMConfigurationAttributes {
  declare id: string;
  declare name: string;
  declare provider: LLMProvider;
  declare model: string;
  declare isDefault: boolean;
  declare isActive: boolean;
  declare apiKey?: string;
  declare temperature: number;
  declare topP: number;
  declare extractionStrictness: ExtractionStrictness;
  declare extractionPrompt?: string;
  declare summaryPrompt?: string;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

LLMConfiguration.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    provider: {
      type: DataTypes.ENUM(...Object.values(LLMProvider)),
      allowNull: false,
    },
    model: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_default',
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active',
    },
    apiKey: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'api_key',
    },
    temperature: {
      type: DataTypes.FLOAT,
      defaultValue: 0.1,
      validate: {
        min: 0,
        max: 2,
      },
    },
    topP: {
      type: DataTypes.FLOAT,
      defaultValue: 0.95,
      field: 'top_p',
      validate: {
        min: 0,
        max: 1,
      },
    },
    extractionStrictness: {
      type: DataTypes.ENUM(...Object.values(ExtractionStrictness)),
      defaultValue: ExtractionStrictness.STRICT,
      field: 'extraction_strictness',
    },
    extractionPrompt: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'extraction_prompt',
    },
    summaryPrompt: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'summary_prompt',
    },
  },
  {
    sequelize,
    tableName: 'llm_configurations',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['provider'] },
      { fields: ['is_default'] },
      { fields: ['is_active'] },
    ],
  }
);