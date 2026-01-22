import { LLMConfiguration, LLMProvider } from '../../models/index.js';
import { CVExtractionResponse, LLMRequest, LLMResponse } from '../../types/index.js';
import { BaseLLMProvider, type ILLMProvider } from './base.js';
import { getGeminiProvider } from './gemini.js';
import { getOpenAIProvider } from './openai.js';
import { getGrokProvider } from './grok.js';
import { logger } from '../../utils/logger.js';

export type { ILLMProvider } from './base.js';
export * from './prompts.js';

/**
 * LLM Service - Pluggable LLM orchestration
 * Supports multiple providers: Gemini, OpenAI, Grok
 */
class LLMService {
  private providers: Map<LLMProvider, ILLMProvider> = new Map();
  private defaultProvider: LLMProvider | null = null;

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Initialize all available providers
    const gemini = getGeminiProvider();
    this.providers.set(LLMProvider.GEMINI, gemini);

    const openai = getOpenAIProvider();
    this.providers.set(LLMProvider.OPENAI, openai);

    const grok = getGrokProvider();
    this.providers.set(LLMProvider.GROK, grok);

    logger.info(`LLM Service initialized with providers: ${Array.from(this.providers.keys()).join(', ')}`);
  }

  /**
   * Get a specific provider
   */
  getProvider(provider?: LLMProvider): ILLMProvider {
    const targetProvider = provider || this.defaultProvider || LLMProvider.GEMINI;
    const llmProvider = this.providers.get(targetProvider);
    
    if (!llmProvider) {
      // Try fallback to any available provider
      const availableProvider = this.providers.values().next().value;
      if (availableProvider) {
        logger.warn(`Provider ${targetProvider} not available, falling back to ${availableProvider.provider}`);
        return availableProvider;
      }
      throw new Error(`No LLM provider available. Requested: ${targetProvider}`);
    }
    
    return llmProvider;
  }

  /**
   * Get all available providers
   */
  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a specific provider is available
   */
  isProviderAvailable(provider: LLMProvider): boolean {
    return this.providers.has(provider);
  }

  /**
   * Generate a completion using the specified or default provider
   */
  async generateCompletion(
    request: LLMRequest, 
    llmConfig?: LLMConfiguration
  ): Promise<LLMResponse> {
    let config = llmConfig;
    if (!config) {
      config = await LLMConfiguration.findOne({ where: { isDefault: true, isActive: true } }) ?? undefined as any;
      if (!config) {
        throw new Error('No default LLM configuration found');
      }
    }

    const provider = this.getProvider(config.provider);

    // Apply model from config if available
    if (config?.model && 'setModel' in provider) {
      (provider as any).setModel(config.model);
    }

    if ('configure' in provider && config.apiKey) {
      (provider as any).configure(config.apiKey);
    }

    return provider.generateCompletion({
      ...request,
      temperature: request.temperature ?? config?.temperature,
      maxTokens: request.maxTokens,
      topP: request.topP ?? config?.topP,
    });
  }

  /**
   * Extract structured data from CV text
   */
  async extractCVData(
    cvText: string, 
    llmConfig?: LLMConfiguration
  ): Promise<{ result: CVExtractionResponse; provider: string; model: string }> {
    let config = llmConfig;
    if (!config) {
      config = await LLMConfiguration.findOne({ where: { isDefault: true, isActive: true } }) ?? undefined as any;
      if (!config) {
        throw new Error('No default LLM configuration found');
      }
    }

    const provider = this.getProvider(config.provider);

    // Apply model from config if available
    if (config?.model && 'setModel' in provider) {
      (provider as any).setModel(config.model);
    }

    if ('configure' in provider && config.apiKey) {
      (provider as any).configure(config.apiKey);
    }

    const result = await provider.extractCVData(cvText, config);
    
    return {
      result,
      provider: provider.provider,
      model: config?.model || 'default',
    };
  }

  /**
   * Generate a professional summary from extracted CV data
   */
  async generateSummary(
    extractedData: object, 
    llmConfig?: LLMConfiguration
  ): Promise<string> {
    let config = llmConfig;
    if (!config) {
      config = await LLMConfiguration.findOne({ where: { isDefault: true, isActive: true } }) ?? undefined as any;
      if (!config) {
        throw new Error('No default LLM configuration found');
      }
    }

    const provider = this.getProvider(config.provider);

    if (config?.model && 'setModel' in provider) {
      (provider as any).setModel(config.model);
    }

    if ('configure' in provider && config.apiKey) {
      (provider as any).configure(config.apiKey);
    }

    return provider.generateSummary(extractedData, config);
  }

  /**
   * Set the default provider
   */
  setDefaultProvider(provider: LLMProvider): void {
    this.defaultProvider = provider;
    logger.info(`Default LLM provider set to: ${provider}`);
  }

  /**
   * Get the current default provider
   */
  getDefaultProvider(): LLMProvider {
    if (this.defaultProvider) return this.defaultProvider;
    // Fallback to DB default config's provider if available
    // Note: controllers fetch asynchronously when needed; here fallback statically
    return LLMProvider.GEMINI;
  }
}

// Singleton instance
let llmService: LLMService | null = null;

export function getLLMService(): LLMService {
  if (!llmService) {
    llmService = new LLMService();
  }
  return llmService;
}

export { LLMService };