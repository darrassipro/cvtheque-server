import { Response } from 'express';
import { LLMConfiguration, LLMProvider } from '../models/index.js';
import { Op } from 'sequelize';
import { AuthenticatedRequest } from '../types/index.js';
import { NotFoundError, ConflictError, ValidationError } from '../middleware/errorHandler.js';
import { logAudit, logSettingsChange } from '../middleware/audit.js';
import { AuditAction } from '../models/AuditLog.js';
import { getLLMService } from '../services/llm/index.js';

const llmService = getLLMService();

/**
 * List all LLM configurations
 */
export async function listLLMConfigs(req: AuthenticatedRequest, res: Response): Promise<void> {
  const configs = await LLMConfiguration.findAll({
    order: [
      ['isDefault', 'DESC'],
      ['provider', 'ASC'],
      ['name', 'ASC'],
    ],
  });

  // Add availability info
  const configsWithStatus = configs.map(config => {
    const json = config.toJSON();
    const hasApiKey = Boolean(json.apiKey && json.apiKey.length > 0);
    const { apiKey, ...rest } = json as any;
    return {
      ...rest,
      hasApiKey,
      isAvailable: hasApiKey && json.isActive === true,
    };
  });

  res.json({
    success: true,
    data: configsWithStatus,
  });
}

/**
 * Get available LLM providers
 */
export async function getAvailableProviders(req: AuthenticatedRequest, res: Response): Promise<void> {
  const providers = await Promise.all(
    Object.values(LLMProvider).map(async provider => {
      const cfg = await LLMConfiguration.findOne({
        where: {
          provider,
          isActive: true,
        },
      });
      return { provider, isAvailable: Boolean(cfg?.apiKey && cfg.apiKey.length > 0) };
    })
  );

  res.json({
    success: true,
    data: {
      providers,
      defaultProvider: llmService.getDefaultProvider(),
    },
  });
}

/**
 * Get a single LLM configuration
 */
export async function getLLMConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const config = await LLMConfiguration.findByPk(id);
  if (!config) {
    throw new NotFoundError('LLM Configuration');
  }

  const json = config.toJSON() as any;
  const hasApiKey = Boolean(json.apiKey && json.apiKey.length > 0);
  const { apiKey, ...rest } = json;
  res.json({
    success: true,
    data: {
      ...rest,
      hasApiKey,
      isAvailable: hasApiKey && json.isActive === true,
    },
  });
}

/**
 * Create a new LLM configuration
 */
export async function createLLMConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
  const {
    name,
    provider,
    model,
    isDefault,
    isActive,
    apiKey: rawApiKey,
    temperature,
    topP,
    extractionStrictness,
    extractionPrompt,
    summaryPrompt,
  } = req.body;

  // Check if name is unique
  const existing = await LLMConfiguration.findOne({ where: { name } });
  if (existing) {
    throw new ConflictError('A configuration with this name already exists');
  }

  // Require apiKey for DB-based credentials
  const apiKey = (rawApiKey ?? req.body.api_key ?? req.body.key) as string | undefined;
  
  console.log('=== LLM Config CREATE Debug ===');
  console.log('Full body:', JSON.stringify(req.body, null, 2));
  console.log('Body keys:', Object.keys(req.body));
  console.log('apiKey variants - rawApiKey:', rawApiKey, 'api_key:', req.body.api_key, 'key:', req.body.key);
  console.log('Final apiKey:', apiKey ? `[${apiKey.length} chars]` : 'undefined');
  console.log('==============================');
  
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    console.error('VALIDATION ERROR: apiKey is required for LLM configuration');
    console.error('Received body:', req.body);
    throw new ValidationError('apiKey is required for LLM configuration');
  }

  // If setting as default, unset other defaults
  if (isDefault) {
    await LLMConfiguration.update(
      { isDefault: false },
      { where: { isDefault: true } }
    );
  }

  const config = await LLMConfiguration.create({
    name,
    provider,
    model,
    isDefault: isDefault || false,
    isActive: isActive !== false,
    apiKey,
    temperature: temperature ?? 0.1,
    topP: topP ?? 0.95,
    extractionStrictness: extractionStrictness || 'strict',
    extractionPrompt,
    summaryPrompt,
  });

  // Update default provider if this is the new default
  if (config.isDefault) {
    llmService.setDefaultProvider(config.provider);
  }

  await logAudit(req, AuditAction.CREATE, 'llm_configuration', config.id);

  res.status(201).json({
    success: true,
    message: 'LLM configuration created successfully',
    data: {
      ...config.toJSON(),
      apiKey: undefined,
      hasApiKey: true,
    },
  });
}

/**
 * Update an LLM configuration
 */
export async function updateLLMConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;
  const {
    name,
    model,
    isDefault,
    isActive,
    apiKey: rawApiKey,
    temperature,
    topP,
    extractionStrictness,
    extractionPrompt,
    summaryPrompt,
  } = req.body;

  const config = await LLMConfiguration.findByPk(id);
  if (!config) {
    throw new NotFoundError('LLM Configuration');
  }

  // Check name uniqueness if changed
  if (name && name !== config.name) {
    const existing = await LLMConfiguration.findOne({ where: { name } });
    if (existing) {
      throw new ConflictError('A configuration with this name already exists');
    }
  }

  // If setting as default, unset other defaults
  if (isDefault && !config.isDefault) {
    await LLMConfiguration.update(
      { isDefault: false },
      { where: { isDefault: true } }
    );
  }

  // Track changes for audit
  const oldValues = config.toJSON();

  const updatePayload: any = {
    ...(name && { name }),
    ...(model && { model }),
    ...(isDefault !== undefined && { isDefault }),
    ...(isActive !== undefined && { isActive }),
    ...(temperature !== undefined && { temperature }),
    ...(topP !== undefined && { topP }),
    ...(extractionStrictness && { extractionStrictness }),
    ...(extractionPrompt !== undefined && { extractionPrompt }),
    ...(summaryPrompt !== undefined && { summaryPrompt }),
  };

  const apiKey = (rawApiKey ?? req.body.api_key ?? req.body.key) as string | undefined;
  if (apiKey !== undefined) {
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new ValidationError('apiKey must be a non-empty string when provided');
    }
    updatePayload.apiKey = apiKey;
  }

  await config.update(updatePayload);

  // Update default provider if this is the new default
  if (config.isDefault) {
    llmService.setDefaultProvider(config.provider);
  }

  const newValues = config.toJSON() as any;
  if (oldValues.apiKey) oldValues.apiKey = '***';
  if (newValues.apiKey) newValues.apiKey = '***';
  await logSettingsChange(req, `llm_config_${config.id}`, oldValues, newValues);

  res.json({
    success: true,
    message: 'LLM configuration updated successfully',
    data: {
      ...config.toJSON(),
      apiKey: undefined,
      hasApiKey: Boolean(config.apiKey),
    },
  });
}

/**
 * Delete an LLM configuration
 */
export async function deleteLLMConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const config = await LLMConfiguration.findByPk(id);
  if (!config) {
    throw new NotFoundError('LLM Configuration');
  }

  if (config.isDefault) {
    throw new ValidationError('Cannot delete the default configuration. Set another as default first.');
  }

  await logAudit(req, AuditAction.DELETE, 'llm_configuration', config.id);

  await config.destroy();

  res.json({
    success: true,
    message: 'LLM configuration deleted successfully',
  });
}

/**
 * Set a configuration as default
 */
export async function setDefaultLLMConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const config = await LLMConfiguration.findByPk(id);
  if (!config) {
    throw new NotFoundError('LLM Configuration');
  }

  if (!config.isActive) {
    throw new ValidationError('Cannot set inactive configuration as default');
  }

  if (!llmService.isProviderAvailable(config.provider)) {
    throw new ValidationError(`Provider ${config.provider} is not available`);
  }

  // Unset current default
  await LLMConfiguration.update(
    { isDefault: false },
    { where: { isDefault: true } }
  );

  // Set new default
  await config.update({ isDefault: true });

  // Update LLM service default
  llmService.setDefaultProvider(config.provider);

  await logSettingsChange(req, 'default_llm_config', null, config.id);

  res.json({
    success: true,
    message: 'Default configuration updated',
    data: config,
  });
}

/**
 * Test an LLM configuration
 */
export async function testLLMConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const config = await LLMConfiguration.findByPk(id);
  if (!config) {
    throw new NotFoundError('LLM Configuration');
  }
  
  if (!config.apiKey) {
    res.json({
      success: false,
      data: {
        available: false,
        error: 'No apiKey set for this configuration',
      },
    });
    return;
  }

  try {
    // Simple test prompt
    const response = await llmService.generateCompletion(
      {
        prompt: 'Respond with exactly: "LLM connection successful"',
        maxTokens: 50,
      },
      config
    );

    res.json({
      success: true,
      data: {
        available: true,
        response: response.content,
        model: response.model,
        provider: response.provider,
      },
    });
  } catch (error) {
    res.json({
      success: false,
      data: {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}