import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';
import { ValidationError } from './errorHandler.js';

interface ValidateOptions {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Validation Middleware Factory
 * Validates request body, query params, and URL params against Zod schemas
 * 
 * @example
 * const schema = z.object({
 *   email: z.string().email(),
 *   password: z.string().min(8),
 * });
 * 
 * router.post('/register', validate({ body: schema }), handler);
 */
export function validate(schemas: ValidateOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Validate body
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }

      // Validate query params
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }

      // Validate URL params
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors: Record<string, string[]> = {};
        
        for (const issue of error.issues) {
          const path = issue.path.join('.') || 'value';
          if (!errors[path]) errors[path] = [];
          errors[path].push(issue.message);
        }

        res.status(400).json({
          success: false,
          error: 'Validation failed',
          message: 'Request validation failed',
          errors,
        });
        return;
      }
      next(error);
    }
  };
}

// ==================== COMMON VALIDATION SCHEMAS ====================

export const commonSchemas = {
  // UUID validation
  uuid: z.string().uuid('Invalid ID format'),

  // Pagination
  pagination: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),

  // Email
  email: z.string().email('Invalid email address').toLowerCase().trim(),

  // Password (strong)
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),

  // Simple password (for development)
  passwordSimple: z.string().min(6, 'Password must be at least 6 characters'),

  // Name
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .trim(),

  // Search query
  searchQuery: z.string().max(500).optional(),

  // Date
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
};

// ==================== AUTH SCHEMAS ====================

export const authSchemas = {
  login: z.object({
    email: commonSchemas.email,
    password: z.string().min(1, 'Password is required'),
  }),

  register: z.object({
    email: commonSchemas.email,
    password: commonSchemas.passwordSimple,
    firstName: commonSchemas.name,
    lastName: commonSchemas.name,
  }),

  refreshToken: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),

  changePassword: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: commonSchemas.passwordSimple,
  }),

  resetPassword: z.object({
    email: commonSchemas.email,
  }),
};

// ==================== USER SCHEMAS ====================

export const userSchemas = {
  create: z.object({
    email: commonSchemas.email,
    password: commonSchemas.passwordSimple,
    firstName: commonSchemas.name,
    lastName: commonSchemas.name,
    role: z.enum(['SUPERADMIN', 'ADMIN', 'MODERATOR', 'USER']).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING']).optional(),
  }),

  update: z.object({
    firstName: commonSchemas.name.optional(),
    lastName: commonSchemas.name.optional(),
    avatar: z.string().url().optional().nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING']).optional(),
  }),

  updateProfile: z.object({
    firstName: commonSchemas.name.optional(),
    lastName: commonSchemas.name.optional(),
    email: commonSchemas.email.optional(),
    phone: z.string().max(20).optional().nullable().or(z.literal('')),
  }),

  updateCV: z.object({
    fullName: z.string().max(200).optional(),
    email: commonSchemas.email.optional(),
    phone: z.string().max(20).optional().nullable().or(z.literal('')),
    location: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    country: z.string().max(100).optional(),
    age: z.union([z.number(), z.string()]).optional().nullable(),
    gender: z.string().max(20).optional().nullable(),
    education: z.array(z.any()).optional(),
    experience: z.array(z.any()).optional(),
    skills: z.any().optional(),
    languages: z.array(z.any()).optional(),
    certifications: z.array(z.any()).optional(),
    internships: z.array(z.any()).optional(),
  }),

  updateRole: z.object({
    role: z.enum(['SUPERADMIN', 'ADMIN', 'MODERATOR', 'USER']),
  }),

  params: z.object({
    id: commonSchemas.uuid,
  }),

  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    role: z.enum(['SUPERADMIN', 'ADMIN', 'MODERATOR', 'USER']).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING']).optional(),
    search: z.string().optional(),
  }),
};

// ==================== CV SCHEMAS ====================

export const cvSchemas = {
  params: z.object({
    id: commonSchemas.uuid,
  }),

  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
    search: z.string().optional(),
    skills: z.string().optional(), // Comma-separated
    minExperience: z.coerce.number().optional(),
    maxExperience: z.coerce.number().optional(),
    seniorityLevel: z.string().optional(),
    industry: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),

  search: z.object({
    query: z.string().optional(),
    skills: z.array(z.string()).optional(),
    experience: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
    }).optional(),
    seniorityLevel: z.array(z.string()).optional(),
    industry: z.array(z.string()).optional(),
    location: z.string().optional(),
    languages: z.array(z.string()).optional(),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(100).default(20),
  }),
};

// ==================== CV LIST SCHEMAS ====================

export const cvListSchemas = {
  create: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    isPublic: z.boolean().default(false),
  }),

  update: z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional().nullable(),
    isPublic: z.boolean().optional(),
  }),

  addItem: z.object({
    cvId: commonSchemas.uuid,
    notes: z.string().max(2000).optional(),
  }),

  share: z.object({
    userId: commonSchemas.uuid,
    canEdit: z.boolean().default(false),
    expiresAt: z.string().datetime().optional(),
  }),

  params: z.object({
    id: commonSchemas.uuid,
  }),

  itemParams: z.object({
    id: commonSchemas.uuid,
    itemId: commonSchemas.uuid,
  }),
};

// ==================== LLM CONFIG SCHEMAS ====================

export const llmConfigSchemas = {
  create: z.object({
    name: z.string().min(1).max(100),
    provider: z.enum(['GEMINI', 'OPENAI', 'GROK']),
    model: z.string().min(1).max(100),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
    temperature: z.number().optional(),
    topP: z.number().optional(),
    maxTokens: z.number().optional(),
    extractionStrictness: z.enum(['strict', 'moderate', 'lenient']).optional(),
    extractionPrompt: z.string().optional(),
    summaryPrompt: z.string().optional(),
  }).passthrough(), // Allow apiKey and other unknown fields to reach controller

  update: z.object({
    name: z.string().min(1).max(100).optional(),
    model: z.string().min(1).max(100).optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
    temperature: z.number().optional(),
    topP: z.number().optional(),
    maxTokens: z.number().optional(),
    extractionStrictness: z.enum(['strict', 'moderate', 'lenient']).optional(),
    extractionPrompt: z.string().optional().nullable(),
    summaryPrompt: z.string().optional().nullable(),
  }).passthrough(), // Allow apiKey and other unknown fields to reach controller

  params: z.object({
    id: commonSchemas.uuid,
  }),
};