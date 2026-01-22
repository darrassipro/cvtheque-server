import { Request } from 'express';
import { UserRole } from '../models/User.js';

// ==================== AUTH TYPES ====================

export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

// ==================== CV EXTRACTION TYPES ====================

export interface CVExtractionInput {
  rawText: string;
  documentType: string;
  language?: string;
}

export interface PersonalInfo {
  full_name: string | null;
  position?: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  city?: string | null;
  country?: string | null;
  age: number | null;
  gender: string | null;
}

export interface EducationEntry {
  degree: string;
  institution: string;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
  description?: string | null;
}

export interface ExperienceEntry {
  job_title: string;
  company: string;
  start_date: string | null;
  end_date: string | null;
  responsibilities: string[];
  achievements: string[];
  location?: string | null;
}

export interface LanguageEntry {
  language: string;
  proficiency: string | null;
  spoken?: string | null;
  written?: string | null;
}

export interface CertificationEntry {
  name: string;
  issuer: string | null;
  date: string | null;
  expiry_date?: string | null;
  credential_id?: string | null;
}

export interface InternshipEntry {
  title: string;
  company: string;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
}

export interface CVMetadata {
  total_experience_years: number | null;
  seniority_level: string;
  industry: string;
  keywords: string[];
}

export interface CVExtractionResult {
  personal_info: PersonalInfo;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  skills: {
    technical: string[];
    soft: string[];
    tools: string[];
  };
  languages: LanguageEntry[];
  certifications: CertificationEntry[];
  internships: InternshipEntry[];
  metadata: CVMetadata;
  photo_detected: boolean;
  confidence_score: number;
}

export interface CVExtractionError {
  error: 'EXTRACTION_FAILED';
  reason: string;
}

export type CVExtractionResponse = CVExtractionResult | CVExtractionError;

// ==================== API RESPONSE TYPES ====================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  errors?: Record<string, string[]>;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ==================== FILE UPLOAD TYPES ====================

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  destination: string;
  filename: string;
  path: string;
  size: number;
}

export interface GoogleDriveFile {
  fileId: string;
  mimeType: string;
  name: string;
  webViewLink?: string;
}

export interface CloudinaryUploadResult {
  publicId: string;
  secureUrl: string;
  width: number;
  height: number;
  format: string;
}

// ==================== LLM TYPES ====================

export interface LLMRequest {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ==================== SEARCH & FILTER TYPES ====================

export interface CVSearchParams {
  query?: string;
  skills?: string[];
  experience?: {
    min?: number;
    max?: number;
  };
  seniorityLevel?: string[];
  industry?: string[];
  location?: string;
  language?: string[];
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ==================== STATISTICS TYPES ====================

export interface DashboardStats {
  totalCVs: number;
  processedCVs: number;
  pendingCVs: number;
  failedCVs: number;
  totalUsers: number;
  activeUsers: number;
  recentActivity: ActivityEntry[];
}

export interface ActivityEntry {
  id: string;
  action: string;
  resource: string;
  userId: string;
  userName: string;
  timestamp: Date;
}