import { User, UserRole, UserStatus, LLMConfiguration, LLMProvider, ExtractionStrictness } from '../models/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Seed the superadmin user if it doesn't exist
 */
export async function seedSuperAdmin(): Promise<void> {
  try {
    const existingSuperAdmin = await User.findOne({
      where: { role: UserRole.SUPERADMIN },
    });

    if (existingSuperAdmin) {
      logger.info('Superadmin user already exists');
      return;
    }

    const superadmin = await User.create({
      email: config.superadmin.email,
      password: config.superadmin.password,
      firstName: 'Super',
      lastName: 'Admin',
      role: UserRole.SUPERADMIN,
      status: UserStatus.ACTIVE,
    });

    logger.info(`✅ Superadmin user created: ${superadmin.email}`);
  } catch (error) {
    logger.error('Failed to seed superadmin:', error);
  }
}

/**
 * Seed default LLM configurations
 */
export async function seedLLMConfigurations(): Promise<void> {
  try {
    const existingConfigs = await LLMConfiguration.count();
    
    if (existingConfigs > 0) {
      logger.info('LLM configurations already exist');
      return;
    }

    const configs = [
      {
        name: 'Gemini 2.0 Flash (Default)',
        provider: LLMProvider.GEMINI,
        model: 'gemini-2.0-flash-exp',
        isDefault: true,
        isActive: true,
        temperature: 0.1,
        maxTokens: 8192,
        topP: 0.95,
        extractionStrictness: ExtractionStrictness.STRICT,
      },
      {
        name: 'Gemini 1.5 Flash',
        provider: LLMProvider.GEMINI,
        model: 'gemini-1.5-flash-latest',
        isDefault: false,
        isActive: true,
        temperature: 0.1,
        maxTokens: 4096,
        topP: 0.95,
        extractionStrictness: ExtractionStrictness.STRICT,
      },
      {
        name: 'Gemini 1.5 Pro',
        provider: LLMProvider.GEMINI,
        model: 'gemini-1.5-pro-latest',
        isDefault: false,
        isActive: true,
        temperature: 0.1,
        maxTokens: 8192,
        topP: 0.95,
        extractionStrictness: ExtractionStrictness.STRICT,
      },
      {
        name: 'GPT-4o Mini',
        provider: LLMProvider.OPENAI,
        model: 'gpt-4o-mini',
        isDefault: false,
        isActive: true,
        temperature: 0.1,
        maxTokens: 4096,
        topP: 0.95,
        extractionStrictness: ExtractionStrictness.STRICT,
      },
      {
        name: 'GPT-4o',
        provider: LLMProvider.OPENAI,
        model: 'gpt-4o',
        isDefault: false,
        isActive: true,
        temperature: 0.1,
        maxTokens: 4096,
        topP: 0.95,
        extractionStrictness: ExtractionStrictness.STRICT,
      },
      {
        name: 'Grok Beta',
        provider: LLMProvider.GROK,
        model: 'grok-beta',
        isDefault: false,
        isActive: true,
        temperature: 0.1,
        maxTokens: 4096,
        topP: 0.95,
        extractionStrictness: ExtractionStrictness.MODERATE,
      },
    ];

    for (const configData of configs) {
      await LLMConfiguration.create(configData);
    }

    logger.info(`✅ ${configs.length} LLM configurations created`);
  } catch (error) {
    logger.error('Failed to seed LLM configurations:', error);
  }
}

/**
 * Run all seed functions
 */
export async function runAllSeeds(): Promise<void> {
  logger.info('Running database seeds...');
  
  await seedSuperAdmin();
  await seedLLMConfigurations();
  
  logger.info('✅ All seeds completed');
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  import('../config/database.js').then(async ({ connectDatabase, syncDatabase }) => {
    await connectDatabase();
    await syncDatabase(false);
    await runAllSeeds();
    process.exit(0);
  }).catch(error => {
    logger.error('Seed script failed:', error);
    process.exit(1);
  });
}