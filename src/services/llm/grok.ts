import OpenAI from 'openai';
import { LLMRequest, LLMResponse } from '../../types/index.js';
import { LLMProvider } from '../../models/index.js';
import { BaseLLMProvider } from './base.js';
import { logger } from '../../utils/logger.js';

/**
 * Grok (xAI) LLM Provider
 * Uses OpenAI-compatible API
 */
export class GrokProvider extends BaseLLMProvider {
  provider = LLMProvider.GROK;
  private client: OpenAI | null = null;
  private currentModelName: string = 'grok-beta';

  constructor() {
    super();
  }

  configure(apiKey: string): void {
    try {
      this.client = new OpenAI({
        apiKey,
        baseURL: 'https://api.x.ai/v1',
      });
      logger.info('Grok provider configured from DB');
    } catch (error) {
      logger.error('Failed to configure Grok provider:', error);
      this.client = null;
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Set the model to use
   */
  setModel(modelName: string): void {
    this.currentModelName = modelName;
  }

  async generateCompletion(request: LLMRequest): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Grok provider not initialized');
    }

    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }

      messages.push({ role: 'user', content: request.prompt });

      const response = await this.client.chat.completions.create({
        model: this.currentModelName,
        messages,
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 4096,
        top_p: request.topP ?? 0.95,
      });

      const choice = response.choices[0];
      const content = choice.message.content || '';

      return {
        content,
        model: this.currentModelName,
        provider: 'grok',
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        } : undefined,
      };
    } catch (error) {
      logger.error('Grok completion error:', error);
      throw new Error(`Grok API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Singleton instance
let grokProvider: GrokProvider | null = null;

export function getGrokProvider(): GrokProvider {
  if (!grokProvider) {
    grokProvider = new GrokProvider();
  }
  return grokProvider;
}