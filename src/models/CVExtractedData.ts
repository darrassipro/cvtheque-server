import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database.js';
import { CV } from './CV.js';

export interface Education {
  degree: string;
  institution: string;
  fieldOfStudy?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface Experience {
  jobTitle: string;
  company: string;
  startDate?: string;
  endDate?: string;
  responsibilities?: string[];
  achievements?: string[];
  location?: string;
}

export interface Language {
  language: string;
  proficiency?: string;
  spoken?: string;
  written?: string;
}

export interface Skills {
  technical: string[];
  soft: string[];
  tools: string[];
}

export interface Certification {
  name: string;
  issuer?: string;
  date?: string;
  expiryDate?: string;
  credentialId?: string;
}

export interface Internship {
  title: string;
  company: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface CVExtractedDataAttributes {
  id: string;
  cvId: string;
  
  // Personal Info
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  city?: string;
  country?: string;
  age?: number;
  gender?: string;
  
  // Structured Data (JSON)
  education?: Education[];
  experience?: Experience[];
  skills?: Skills;
  languages?: Language[];
  certifications?: Certification[];
  internships?: Internship[];
  
  // Computed Metadata
  totalExperienceYears?: number;
  seniorityLevel?: string;
  industry?: string;
  keywords?: string[];
  
  // Raw extracted text for search
  rawText?: string;
  
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CVExtractedDataCreationAttributes extends Optional<CVExtractedDataAttributes,
  'id' | 'fullName' | 'email' | 'phone' | 'location' | 'city' | 'country' | 'age' | 'gender' |
  'education' | 'experience' | 'skills' | 'languages' | 'certifications' | 'internships' |
  'totalExperienceYears' | 'seniorityLevel' | 'industry' | 'keywords' | 'rawText' |
  'createdAt' | 'updatedAt'
> {}

export class CVExtractedData extends Model<CVExtractedDataAttributes, CVExtractedDataCreationAttributes> implements CVExtractedDataAttributes {
  declare id: string;
  declare cvId: string;
  declare fullName?: string;
  declare email?: string;
  declare phone?: string;
  declare location?: string;
  declare city?: string;
  declare country?: string;
  declare age?: number;
  declare gender?: string;
  declare education?: Education[];
  declare experience?: Experience[];
  declare skills?: Skills;
  declare languages?: Language[];
  declare certifications?: Certification[];
  declare internships?: Internship[];
  declare totalExperienceYears?: number;
  declare seniorityLevel?: string;
  declare industry?: string;
  declare keywords?: string[];
  declare rawText?: string;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

CVExtractedData.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    cvId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      field: 'cv_id',
      references: {
        model: 'cvs',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    fullName: {
      type: DataTypes.STRING(200),
      allowNull: true,
      field: 'full_name',
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    location: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    country: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    age: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    gender: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    education: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
    },
    experience: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
    },
    skills: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: { technical: [], soft: [], tools: [] },
    },
    languages: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
    },
    certifications: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
    },
    internships: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
    },
    totalExperienceYears: {
      type: DataTypes.FLOAT,
      allowNull: true,
      field: 'total_experience_years',
    },
    seniorityLevel: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: 'seniority_level',
    },
    industry: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    keywords: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
    },
    rawText: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'raw_text',
    },
  },
  {
    sequelize,
    tableName: 'cv_extracted_data',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['cv_id'], unique: true },
      { fields: ['full_name'] },
      { fields: ['email'] },
      { fields: ['seniority_level'] },
      { fields: ['industry'] },
    ],
  }
);

// Associations
CV.hasOne(CVExtractedData, { foreignKey: 'cvId', as: 'extractedData' });
CVExtractedData.belongsTo(CV, { foreignKey: 'cvId', as: 'cv' });