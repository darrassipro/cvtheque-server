import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvVarOptional(key: string): string | undefined {
  return process.env[key];
}

function getEnvVarNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

function getEnvVarBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

export const config = {
  env: getEnvVar('NODE_ENV', 'development'),

  server: {
    port: getEnvVarNumber('PORT', 12000),
    httpsPort: getEnvVarNumber('HTTPS_PORT', 12001),
    host: getEnvVar('HOST', '0.0.0.0'),
  },

  database: {
    dialect: getEnvVar('DB_DIALECT', 'mysql') as 'mysql',
    host: getEnvVar('DB_HOST', 'localhost'),
    port: getEnvVarNumber('DB_PORT', 3306),
    name: getEnvVar('DB_NAME', 'cvtech'),
    user: getEnvVar('DB_USER', 'root'),
    password: getEnvVar('DB_PASSWORD', ''),
    sync: getEnvVarBoolean('SEQUELIZE_SYNC', false),
  },

  jwt: {
    secret: getEnvVar('JWT_SECRET', 'dev-jwt-secret-change-in-production-min-32'),
    refreshSecret: getEnvVar('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-in-production'),
    expiresIn: getEnvVar('JWT_EXPIRES_IN', '15m'),
    refreshExpiresIn: getEnvVar('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  googleDrive: {
    serviceAccountEmail: getEnvVarOptional('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    privateKey: getEnvVarOptional('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n'),
    folderId: getEnvVarOptional('GOOGLE_DRIVE_FOLDER_ID'),
  },

  cloudinary: {
    cloudName: getEnvVarOptional('CLOUDINARY_CLOUD_NAME'),
    apiKey: getEnvVarOptional('CLOUDINARY_API_KEY'),
    apiSecret: getEnvVarOptional('CLOUDINARY_API_SECRET'),
  },

  llm: {
    geminiApiKey: getEnvVarOptional('GEMINI_API_KEY'),
    openaiApiKey: getEnvVarOptional('OPENAI_API_KEY'),
    grokApiKey: getEnvVarOptional('GROK_API_KEY'),
    defaultProvider: getEnvVar('DEFAULT_LLM_PROVIDER', 'gemini') as 'gemini' | 'openai' | 'grok',
  },

  ssl: {
    keyPath: getEnvVarOptional('SSL_KEY_PATH'),
    certPath: getEnvVarOptional('SSL_CERT_PATH'),
  },

  rateLimit: {
    windowMs: getEnvVarNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    maxRequests: getEnvVarNumber('RATE_LIMIT_MAX_REQUESTS', 100),
  },

  upload: {
    maxFileSizeMb: getEnvVarNumber('MAX_FILE_SIZE_MB', 10),
    allowedFileTypes: getEnvVar(
      'ALLOWED_FILE_TYPES',
      'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png'
    ).split(','),
  },

  superadmin: {
    email: getEnvVar('SUPERADMIN_EMAIL', 'admin@cvtech.com'),
    password: getEnvVar('SUPERADMIN_PASSWORD', 'ChangeMe123!'),
  },

  cors: {
    origins: getEnvVar('CORS_ORIGINS', 'http://localhost:3000,https://localhost:3000').split(','),
  },
} as const;

export type Config = typeof config;