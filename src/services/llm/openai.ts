import OpenAI from 'openai';
import { LLMRequest, LLMResponse } from '../../types/index.js';
import { LLMProvider } from '../../models/index.js';
import { BaseLLMProvider } from './base.js';
import { logger } from '../../utils/logger.js';

/**
 * OpenAI LLM Provider
 */
export class OpenAIProvider extends BaseLLMProvider {
  provider = LLMProvider.OPENAI;
  private client: OpenAI | null = null;
  private apiKey: string | null = null;
  private currentModelName: string = 'gpt-4-turbo';

  constructor() {
    super();
  }

  configure(apiKey: string): void {
    try {
      this.apiKey = apiKey;
      this.client = new OpenAI({ apiKey });
      logger.info('OpenAI provider configured from DB');
    } catch (error) {
      logger.error('Failed to configure OpenAI provider:', error);
      this.client = null;
      this.apiKey = null;
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
    if (!this.apiKey) {
      throw new Error('OpenAI provider not initialized');
    }

    try {
      const payload = {
        model: this.currentModelName,
        input: request.prompt,
        reasoning: {
          effort: 'none',
        },
      };

      if (request.temperature !== undefined) {
        (payload as any).temperature = request.temperature;
      }

      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json() as any;
        throw new Error(`OpenAI API error: ${errorData?.error?.message || response.statusText}`);
      }

      const data = await response.json() as any;

      // Extract text content from response
      let content = '';
      if (data?.output && Array.isArray(data.output)) {
        const messageOutput = data.output.find((o: any) => o.type === 'message');
        if (messageOutput && messageOutput.content && Array.isArray(messageOutput.content)) {
          const textContent = messageOutput.content.find((c: any) => c.type === 'output_text');
          if (textContent) {
            content = textContent.text;
          }
        }
      }

      return {
        content,
        model: data?.model || this.currentModelName,
        provider: 'openai',
        usage: data?.usage ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
      };
    } catch (error) {
      logger.error('OpenAI completion error:', error);
      throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Singleton instance
let openaiProvider: OpenAIProvider | null = null;

export function getOpenAIProvider(): OpenAIProvider {
  if (!openaiProvider) {
    openaiProvider = new OpenAIProvider();
  }
  return openaiProvider;
}