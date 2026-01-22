import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { LLMRequest, LLMResponse } from '../../types/index.js';
import { LLMProvider } from '../../models/index.js';
import { BaseLLMProvider } from './base.js';
import { logger } from '../../utils/logger.js';

/**
 * Google Gemini LLM Provider
 */
export class GeminiProvider extends BaseLLMProvider {
  provider = LLMProvider.GEMINI;
  private client: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;
  private currentModelName: string = 'gemini-3-flash-preview';

  constructor() {
    super();
  }

  configure(apiKey: string): void {
    try {
      this.client = new GoogleGenerativeAI(apiKey);
      this.model = this.client.getGenerativeModel({ model: this.currentModelName });
      logger.info('Gemini provider configured from DB');
    } catch (error) {
      logger.error('Failed to configure Gemini provider:', error);
      this.client = null;
      this.model = null;
    }
  }

  isAvailable(): boolean {
    return this.client !== null && this.model !== null;
  }

  /**
   * Set the model to use
   */
  setModel(modelName: string): void {
    if (this.client && modelName !== this.currentModelName) {
      this.model = this.client.getGenerativeModel({ model: modelName });
      this.currentModelName = modelName;
    }
  }

  async generateCompletion(request: LLMRequest): Promise<LLMResponse> {
    if (!this.model) {
      throw new Error('Gemini provider not initialized');
    }

    try {
      // Prepare the prompt with system context
      const fullPrompt = request.systemPrompt 
        ? `${request.systemPrompt}\n\n${request.prompt}`
        : request.prompt;

      const generationConfig = {
        temperature: request.temperature ?? 0.1,
        maxOutputTokens: request.maxTokens ?? 4096,
        topP: request.topP ?? 0.95,
      };

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig,
      });

      const response = result.response;
      const text = response.text();

      return {
        content: text,
        model: this.currentModelName,
        provider: 'gemini',
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
        },
      };
    } catch (error) {
      logger.error('Gemini completion error:', error);
      throw new Error(`Gemini API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Singleton instance
let geminiProvider: GeminiProvider | null = null;

export function getGeminiProvider(): GeminiProvider {
  if (!geminiProvider) {
    geminiProvider = new GeminiProvider();
  }
  return geminiProvider;
}