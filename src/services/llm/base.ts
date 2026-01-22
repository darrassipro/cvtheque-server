import { LLMRequest, LLMResponse, CVExtractionResponse } from '../../types/index.js';
import { LLMConfiguration, LLMProvider, ExtractionStrictness } from '../../models/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Base interface for LLM providers
 */
export interface ILLMProvider {
  provider: LLMProvider;
  
  /**
   * Generate a completion from the LLM
   */
  generateCompletion(request: LLMRequest): Promise<LLMResponse>;
  
  /**
   * Extract structured data from CV text
   */
  extractCVData(cvText: string, config?: LLMConfiguration): Promise<CVExtractionResponse>;
  
  /**
   * Generate a professional summary from extracted CV data
   */
  generateSummary(extractedData: object, config?: LLMConfiguration): Promise<string>;
  
  /**
   * Check if the provider is configured and available
   */
  isAvailable(): boolean;
}

/**
 * Base class with shared functionality for LLM providers
 */
export abstract class BaseLLMProvider implements ILLMProvider {
  abstract provider: LLMProvider;
  
  abstract generateCompletion(request: LLMRequest): Promise<LLMResponse>;
  abstract isAvailable(): boolean;

  async extractCVData(cvText: string, config?: LLMConfiguration): Promise<CVExtractionResponse> {
    const { 
      CV_EXTRACTION_SYSTEM_PROMPT, 
      getExtractionPrompt,
      getStrictnessInstructions 
    } = await import('./prompts.js');
    
    const strictness = (config?.extractionStrictness || 'strict') as ExtractionStrictness;
    const systemPrompt = CV_EXTRACTION_SYSTEM_PROMPT + '\n' + getStrictnessInstructions(strictness);
    const userPrompt = config?.extractionPrompt 
      ? config.extractionPrompt.replace('{cv_text}', cvText)
      : getExtractionPrompt(cvText);

    try {
      const response = await this.generateCompletion({
        prompt: userPrompt,
        systemPrompt,
        temperature: config?.temperature ?? 0.1,
        maxTokens: 4096,
        topP: config?.topP ?? 0.95,
      });

      return this.parseExtractionResponse(response.content);
    } catch (error) {
      return {
        error: 'EXTRACTION_FAILED',
        reason: error instanceof Error ? error.message : 'Unknown error during extraction',
      };
    }
  }

  async generateSummary(extractedData: object, config?: LLMConfiguration): Promise<string> {
    const { CV_SUMMARY_SYSTEM_PROMPT, getSummaryPrompt } = await import('./prompts.js');
    
    const userPrompt = config?.summaryPrompt 
      ? config.summaryPrompt.replace('{cv_data}', JSON.stringify(extractedData, null, 2))
      : getSummaryPrompt(extractedData);

    const response = await this.generateCompletion({
      prompt: userPrompt,
      systemPrompt: CV_SUMMARY_SYSTEM_PROMPT,
      temperature: config?.temperature ?? 0.3,
      maxTokens: 500,
      topP: config?.topP ?? 0.95,
    });

    return response.content.trim();
  }

  /**
   * Parse and validate the extraction response JSON
   */
  protected parseExtractionResponse(content: string): CVExtractionResponse {
    // Try to extract JSON from the response
    let jsonStr = content.trim();
    
    // Handle markdown code blocks
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    
    // Try to find JSON object boundaries
    const startIdx = jsonStr.indexOf('{');
    const endIdx = jsonStr.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      jsonStr = jsonStr.substring(startIdx, endIdx + 1);
    }

    try {
      // Clean up common JSON issues
      jsonStr = jsonStr
        .replace(/,\s*}/g, '}')  // Remove trailing commas before closing braces
        .replace(/,\s*]/g, ']')  // Remove trailing commas before closing brackets
        .replace(/\n/g, ' ')     // Replace newlines with spaces
        .replace(/\r/g, '')      // Remove carriage returns
        .trim();

      const parsed = JSON.parse(jsonStr);
      
      // Check if it's an error response
      if (parsed.error === 'EXTRACTION_FAILED') {
        return parsed;
      }

      // Validate required structure
      return this.validateAndNormalizeExtraction(parsed);
    } catch (error: any) {
      logger.error(`JSON parsing error: ${error.message}`);
      logger.error(`Attempted to parse: ${jsonStr.substring(0, 500)}...`);
      return {
        error: 'EXTRACTION_FAILED',
        reason: `Failed to parse LLM response as valid JSON: ${error.message}`,
      };
    }
  }

  /**
   * Validate and normalize extracted data
   */
  protected validateAndNormalizeExtraction(data: any): CVExtractionResponse {
    // Ensure required structure exists
    const result: CVExtractionResponse = {
      personal_info: {
        full_name: data.personal_info?.full_name || null,
        email: data.personal_info?.email || null,
        phone: data.personal_info?.phone || null,
        location: data.personal_info?.location || null,
        age: data.personal_info?.age || null,
        gender: data.personal_info?.gender || null,
      },
      education: Array.isArray(data.education) ? data.education : [],
      experience: Array.isArray(data.experience) ? data.experience : [],
      skills: this.normalizeSkills(data.skills),
      languages: Array.isArray(data.languages) ? data.languages : [],
      certifications: Array.isArray(data.certifications) ? data.certifications : [],
      internships: Array.isArray(data.internships) ? data.internships : [],
      metadata: {
        total_experience_years: data.metadata?.total_experience_years ?? null,
        seniority_level: data.metadata?.seniority_level || '',
        industry: data.metadata?.industry || '',
        keywords: Array.isArray(data.metadata?.keywords) ? data.metadata.keywords : [],
      },
      photo_detected: data.photo_detected || false,
      confidence_score: typeof data.confidence_score === 'number' 
        ? Math.min(Math.max(data.confidence_score, 0), 1) 
        : 0.5,
    };

    return result;
  }

  /**
   * Normalize skills to categorized structure
   */
  protected normalizeSkills(skills: any): { technical: string[], soft: string[], tools: string[] } {
    // If already in categorized format
    if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
      return {
        technical: this.deduplicateSkillsArray(skills.technical || []),
        soft: this.deduplicateSkillsArray(skills.soft || []),
        tools: this.deduplicateSkillsArray(skills.tools || []),
      };
    }
    
    // Legacy flat array format - return empty categories
    if (Array.isArray(skills)) {
      logger.warn('Received skills as flat array, expected categorized object. Using empty categories.');
      return { technical: [], soft: [], tools: [] };
    }
    
    // Invalid format
    return { technical: [], soft: [], tools: [] };
  }

  /**
   * Deduplicate and normalize skills array
   */
  protected deduplicateSkillsArray(skills: any): string[] {
    if (!Array.isArray(skills)) return [];
    
    const seen = new Set<string>();
    return skills
      .filter((skill): skill is string => typeof skill === 'string')
      .map(skill => skill.trim())
      .filter(skill => {
        if (skill === '' || seen.has(skill.toLowerCase())) return false;
        seen.add(skill.toLowerCase());
        return true;
      });
  }
}