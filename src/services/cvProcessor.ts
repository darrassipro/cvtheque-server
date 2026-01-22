import { CV, CVStatus, CVExtractedData, LLMConfiguration } from '../models/index.js';
import { CVExtractionResponse, CVExtractionResult } from '../types/index.js';
import { getTextExtractorService } from './parsing/textExtractor.js';
import { getPhotoExtractorService } from './parsing/photoExtractor.js';
import { getGoogleDriveService } from './storage/googleDrive.js';
import { getCloudinaryService } from './storage/cloudinary.js';
import { getLLMService } from './llm/index.js';
import { logger } from '../utils/logger.js';
import { cleanupUploadedFile } from '../middleware/upload.js';
import crypto from 'crypto';
import fs from 'fs';

export interface CVProcessingResult {
  success: boolean;
  cv: CV;
  extractedData?: CVExtractedData;
  error?: string;
}

interface LanguageProfile {
  code: 'fr' | 'en' | 'mixed';
  confidence: number;
  frenchScore: number;
  englishScore: number;
}

interface ExtractionContext {
  language: LanguageProfile;
  sections: Map<string, { start: number; end: number; content: string }>;
  lines: string[];
  documentType: string;
}

/**
 * Enhanced CV Processing Service with Advanced Extraction
 * Features:
 * - Multi-language support (French, English, Mixed)
 * - Robust pattern matching with fallbacks
 * - Section-aware extraction
 * - Stress-tested edge case handling
 */
class CVProcessorService {
  private textExtractor = getTextExtractorService();
  private photoExtractor = getPhotoExtractorService();
  private driveService = getGoogleDriveService();
  private cloudinaryService = getCloudinaryService();
  private llmService = getLLMService();

  /**
   * Process a CV file completely
   */
  async processCV(
    cv: CV,
    filePath: string,
    llmConfig?: LLMConfiguration,
    llmEnabled: boolean = true
  ): Promise<CVProcessingResult> {
    logger.info(`Starting CV processing for: ${cv.id}, LLM enabled: ${llmEnabled}`);

    try {
      await cv.update({
        status: CVStatus.PROCESSING,
        processingStartedAt: new Date(),
      });

      const checksum = await this.calculateChecksum(filePath);
      await cv.update({ fileChecksum: checksum });

      if (this.driveService.isAvailable()) {
        const driveFile = await this.driveService.uploadFile(
          filePath,
          cv.originalFileName,
          this.getMimeType(cv.documentType)
        );
        await cv.update({
          googleDriveFileId: driveFile.fileId,
          googleDriveMimeType: driveFile.mimeType,
        });
        logger.info(`CV uploaded to Google Drive: ${driveFile.fileId}`);
      }

      const mimeType = this.getMimeType(cv.documentType);
      const textResult = await this.textExtractor.extractText(filePath, mimeType);
      
      const validationResult = this.validateExtractedText(textResult.text, cv.documentType);
      
      if (!validationResult.isValid) {
        throw new Error(`Insufficient text extracted: ${validationResult.reason}`);
      }

      const cleanedText = this.textExtractor.cleanText(textResult.text);
      const detectedLanguage = this.textExtractor.detectLanguage(cleanedText);
      logger.info(`Text extracted: ${cleanedText.length} chars, language: ${detectedLanguage}, quality: ${validationResult.quality}`);
      
      logger.debug(`\n${'='.repeat(80)}\nEXTRACTED TEXT FROM CV (${cv.id}):\n${'='.repeat(80)}\n${cleanedText}\n${'='.repeat(80)}\n`);

      let photoInfo: { url: string; publicId: string; width: number; height: number } | null = null;
      
      if (this.cloudinaryService.isAvailable()) {
        const photo = await this.photoExtractor.extractPhoto(filePath, mimeType);
        
        if (photo) {
          const uploadResult = await this.cloudinaryService.uploadProfilePhoto(photo.buffer, {
            publicId: `cv_${cv.id}`,
          });
          
          photoInfo = {
            url: uploadResult.secureUrl,
            publicId: uploadResult.publicId,
            width: uploadResult.width,
            height: uploadResult.height,
          };
          
          await cv.update({
            photoUrl: photoInfo.url,
            photoPublicId: photoInfo.publicId,
            photoWidth: photoInfo.width,
            photoHeight: photoInfo.height,
          });
          
          logger.info(`Photo uploaded to Cloudinary: ${photoInfo.publicId}`);
        }
      }

      let extractionResult: CVExtractionResult;
      let provider: string = 'basic';
      let model: string = 'regex-based';

      if (llmEnabled && llmConfig) {
        try {
          logger.info(`Using LLM extraction with provider: ${llmConfig.provider}`);
          const llmResult = await this.llmService.extractCVData(cleanedText, llmConfig);
          extractionResult = llmResult.result as CVExtractionResult;
          provider = llmResult.provider;
          model = llmResult.model;

          if ('error' in extractionResult) {
            throw new Error(`LLM extraction failed: ${extractionResult.reason}`);
          }
        } catch (llmError: any) {
          logger.warn(`LLM extraction failed: ${llmError.message}. Falling back to advanced processing.`);
          extractionResult = this.performAdvancedExtraction(cleanedText, cv.documentType);
          provider = 'advanced';
          model = 'regex-based';
        }
      } else {
        logger.info(`Using ADVANCED extraction (LLM disabled)`);
        extractionResult = this.performAdvancedExtraction(cleanedText, cv.documentType);
      }

      const cvData = extractionResult as CVExtractionResult;
      cvData.photo_detected = photoInfo !== null;

      let aiSummary = '';
      if (llmEnabled && llmConfig) {
        aiSummary = await this.llmService.generateSummary(cvData, llmConfig);
        logger.info(`AI summary generated: ${aiSummary.length} chars`);
      } else {
        aiSummary = this.generateAdvancedSummary(cvData);
        logger.info(`Advanced summary generated: ${aiSummary.length} chars`);
      }

      // Handle skills: LLM now returns categorized skills directly
      let skills;
      if (cvData.skills && typeof cvData.skills === 'object' && 'technical' in cvData.skills) {
        // Already categorized from LLM
        skills = {
          technical: cvData.skills.technical || [],
          soft: cvData.skills.soft || [],
          tools: cvData.skills.tools || [],
        };
      } else if (Array.isArray(cvData.skills)) {
        // Fallback for old flat array format
        skills = {
          technical: cvData.skills.filter(s => this.isTechnicalSkill(s)),
          soft: cvData.skills.filter(s => this.isSoftSkill(s)),
          tools: cvData.skills.filter(s => this.isToolSkill(s)),
        };
      } else {
        skills = { technical: [], soft: [], tools: [] };
      }

      const dataToStore = {
        cvId: cv.id,
        fullName: cvData.personal_info.full_name || undefined,
        email: cvData.personal_info.email || undefined,
        phone: cvData.personal_info.phone || undefined,
        location: cvData.personal_info.location || undefined,
        age: cvData.personal_info.age || undefined,
        gender: cvData.personal_info.gender || undefined,
        education: cvData.education as any,
        experience: cvData.experience as any,
        skills: skills as any,
        languages: cvData.languages as any,
        certifications: cvData.certifications as any,
        internships: cvData.internships as any,
        totalExperienceYears: cvData.metadata.total_experience_years || undefined,
        seniorityLevel: cvData.metadata.seniority_level,
        industry: cvData.metadata.industry,
        keywords: cvData.metadata.keywords,
        rawText: cleanedText,
      };
      
      logger.info('[processCV] DATA TO STORE IN DATABASE:');
      logger.info(JSON.stringify(dataToStore, null, 2));
      
      const extractedData = await CVExtractedData.create(dataToStore);

      await cv.update({
        status: CVStatus.COMPLETED,
        processingCompletedAt: new Date(),
        aiSummary,
        confidenceScore: cvData.confidence_score,
        llmProvider: provider,
        llmModel: model,
        extractionVersion: '2.0.0',
      });

      await cleanupUploadedFile(filePath);

      logger.info(`CV processing completed: ${cv.id}`);

      return {
        success: true,
        cv: await cv.reload(),
        extractedData,
      };
    } catch (error) {
      logger.error(`CV processing failed for ${cv.id}:`, error);

      await cv.update({
        status: CVStatus.FAILED,
        processingError: error instanceof Error ? error.message : 'Unknown error',
      });

      await cleanupUploadedFile(filePath);

      return {
        success: false,
        cv: await cv.reload(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * ADVANCED EXTRACTION ENGINE
   * Multi-phase, context-aware extraction with language detection
   */
  private performAdvancedExtraction(text: string, documentType: string): CVExtractionResult {
    logger.info('[ADVANCED] Starting advanced extraction engine');
    
    const context = this.buildExtractionContext(text, documentType);
    
    logger.info(`[ADVANCED] Language detected: ${context.language.code} (confidence: ${context.language.confidence.toFixed(2)})`);
    logger.info(`[ADVANCED] Sections identified: ${Array.from(context.sections.keys()).join(', ')}`);

    const personalInfo = this.extractPersonalInfo(context);
    const experience = this.extractExperienceAdvanced(context);
    const education = this.extractEducationAdvanced(context);
    const skills = this.extractSkillsAdvanced(context);
    const languages = this.extractLanguagesAdvanced(context);
    const certifications = this.extractCertificationsAdvanced(context);
    const projects = this.extractProjectsAdvanced(context);
    
    const totalExperienceYears = this.calculateExperienceYears(experience);
    const seniorityLevel = this.estimateSeniority(totalExperienceYears, experience, education);
    const industry = this.detectIndustry(skills, experience);

    const result: CVExtractionResult = {
      confidence_score: this.calculateConfidenceScore(personalInfo, experience, education, skills),
      photo_detected: false,
      personal_info: personalInfo,
      education: education,
      experience: experience,
      skills: skills,
      languages: languages,
      certifications: certifications,
      internships: projects,
      metadata: {
        total_experience_years: totalExperienceYears,
        seniority_level: seniorityLevel,
        industry: industry,
        keywords: [...skills, ...languages],
      },
    };

    logger.info('[ADVANCED] Extraction complete');
    logger.info(JSON.stringify(result, null, 2));

    return result;
  }

  /**
   * Build extraction context with language detection and section mapping
   */
  private buildExtractionContext(text: string, documentType: string): ExtractionContext {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const language = this.detectLanguage(text);
    const sections = this.identifySections(text, language);

    return {
      language,
      sections,
      lines,
      documentType,
    };
  }

  /**
   * Advanced language detection
   */
  private detectLanguage(text: string): LanguageProfile {
    const textLower = text.toLowerCase();

    const frenchKeywords = [
      'expérience', 'éducation', 'formation', 'compétences', 'competences',
      'langues', 'certifications', 'projets', 'professionnel', 'développeur',
      'ingénieur', 'université', 'école', 'diplôme', 'licence', 'master',
      'stage', 'mission', 'réalisation', 'responsabilités', 'poste'
    ];

    const englishKeywords = [
      'experience', 'education', 'skills', 'languages', 'certifications',
      'projects', 'professional', 'developer', 'engineer', 'university',
      'school', 'degree', 'bachelor', 'master', 'internship', 'position',
      'responsibilities', 'achievements', 'role'
    ];

    let frenchScore = 0;
    let englishScore = 0;

    frenchKeywords.forEach(kw => {
      const regex = new RegExp(`\\b${kw}\\b`, 'gi');
      const matches = textLower.match(regex);
      if (matches) frenchScore += matches.length;
    });

    englishKeywords.forEach(kw => {
      const regex = new RegExp(`\\b${kw}\\b`, 'gi');
      const matches = textLower.match(regex);
      if (matches) englishScore += matches.length;
    });

    const total = frenchScore + englishScore;
    const confidence = total > 0 ? Math.max(frenchScore, englishScore) / total : 0.5;

    let code: 'fr' | 'en' | 'mixed' = 'en';
    if (frenchScore > englishScore * 1.5) {
      code = 'fr';
    } else if (englishScore > frenchScore * 1.5) {
      code = 'en';
    } else {
      code = 'mixed';
    }

    return {
      code,
      confidence,
      frenchScore,
      englishScore,
    };
  }

  /**
   * Identify and map CV sections
   */
  private identifySections(text: string, language: LanguageProfile): Map<string, { start: number; end: number; content: string }> {
    const sections = new Map();

    const sectionPatterns = {
      experience: language.code === 'fr' 
        ? /(?:EXPÉRIENCE|EXPERIENCE PROFESSIONNELLE|PARCOURS PROFESSIONNEL)/i
        : /(?:EXPERIENCE|PROFESSIONAL EXPERIENCE|WORK HISTORY|EMPLOYMENT)/i,
      education: language.code === 'fr'
        ? /(?:FORMATION|ÉDUCATION|ÉTUDES|PARCOURS ACADÉMIQUE)/i
        : /(?:EDUCATION|ACADEMIC BACKGROUND|QUALIFICATIONS)/i,
      skills: language.code === 'fr'
        ? /(?:COMPÉTENCES|COMPETENCES|SAVOIR-FAIRE)/i
        : /(?:SKILLS|COMPETENCIES|TECHNICAL SKILLS|EXPERTISE)/i,
      languages: language.code === 'fr'
        ? /(?:LANGUES)/i
        : /(?:LANGUAGES)/i,
      certifications: language.code === 'fr'
        ? /(?:CERTIFICATIONS|CERTIFICATS)/i
        : /(?:CERTIFICATIONS|CERTIFICATES|LICENSES)/i,
      projects: language.code === 'fr'
        ? /(?:PROJETS|RÉALISATIONS)/i
        : /(?:PROJECTS|PORTFOLIO|KEY PROJECTS)/i,
      summary: language.code === 'fr'
        ? /(?:RÉSUMÉ|PROFIL|À PROPOS)/i
        : /(?:SUMMARY|PROFILE|ABOUT|OBJECTIVE)/i,
    };

    const lines = text.split('\n');
    const sectionStarts: Array<{ name: string; index: number }> = [];

    Object.entries(sectionPatterns).forEach(([name, pattern]) => {
      lines.forEach((line, idx) => {
        if (pattern.test(line.trim())) {
          sectionStarts.push({ name, index: idx });
        }
      });
    });

    sectionStarts.sort((a, b) => a.index - b.index);

    sectionStarts.forEach((section, idx) => {
      const start = section.index;
      const end = idx < sectionStarts.length - 1 ? sectionStarts[idx + 1].index : lines.length;
      const content = lines.slice(start, end).join('\n');

      sections.set(section.name, {
        start,
        end,
        content,
      });
    });

    return sections;
  }

  /**
   * Extract personal information with multi-phase approach
   */
  private extractPersonalInfo(context: ExtractionContext): any {
    logger.info('[ADVANCED] Extracting personal info');

    const { lines } = context;
    const fullText = lines.join('\n');

    // Email - Enhanced pattern that explicitly excludes digits before @
    const emailPattern = /(?<!\d)([a-zA-Z][\w.+-]*@[a-zA-Z0-9][\w.-]*\.[a-zA-Z]{2,})/;
    const emailMatch = fullText.match(emailPattern);

    // Phone - More strict pattern that stops at year boundaries
    const phonePattern = /(?:Tel|Phone|Mobile|Téléphone|Tél|GSM|Contact)?[\s:]*(\+?\d{10,15})(?!\d*[-]\d{4})/i;
    const phoneMatch = fullText.match(phonePattern);

    // Clean phone number
    let cleanPhone = '';
    if (phoneMatch) {
      cleanPhone = phoneMatch[1].replace(/[\s.\-()]/g, '').trim();
      // Validate phone length (10-15 digits)
      if (cleanPhone.length < 10 || cleanPhone.length > 15) {
        cleanPhone = '';
      }
    }

    // Name extraction - Multi-phase strategy
    const fullName = this.extractNameMultiPhase(context, emailMatch?.[0], phoneMatch?.[0]);

    // Position/Title
    const position = this.extractPosition(context);

    // Location
    const location = this.extractLocation(context);

    // LinkedIn
    const linkedinPattern = /(?:linkedin\.com\/in\/|lnkd\.in\/|linkedin:?\s*)([a-zA-Z0-9\-]+)/i;
    const linkedinMatch = fullText.match(linkedinPattern);

    const result = {
      full_name: fullName,
      position: position,
      email: emailMatch ? emailMatch[1].trim() : '',
      phone: cleanPhone,
      location: location,
      linkedin: linkedinMatch ? `https://linkedin.com/in/${linkedinMatch[1]}` : '',
      age: null,
      gender: null,
    };

    logger.debug(`[ADVANCED] Personal info: ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * Multi-phase name extraction with fallbacks
   */
  private extractNameMultiPhase(context: ExtractionContext, email?: string, phone?: string): string {
    const { lines } = context;
    
    // Enhanced exclude patterns - be more aggressive
    const excludePatterns = [
      /^(?:CURRICULUM|VITAE|CV|RESUME|RÉSUMÉ)/i,
      /\b(?:ENGINEER|MANAGER|DEVELOPER|DÉVELOPPEUR|DIRECTOR|DESIGNER|ARCHITECT|INGÉNIEUR|ANALYST|CONSULTANT|SPECIALIST|COORDINATOR|TECHNICIAN|TECHNICIEN|OFFICER|EXECUTIVE|SUPERVISOR|ASSISTANT|INTERN|LEAD|CHIEF|HEAD|FULL STACK|FRONTEND|BACKEND|GÉNIE|INFORMATIQUE|FABRICATION|MECANIQUE|MÉCANIQUE)\b/i,
      /@|http|www\.|github\.com|linkedin/i,
      /^\d+/,
      /EXPERIENCE|EDUCATION|SKILLS|FORMATION|COMPÉTENCES|COMPETENCES|PROJET|PROJECT|CERTIFICATION/i,
      /\d{4}\s*[-–—]\s*\d{4}/, // Date ranges
      /^\s*fes\s*$/i, // City names alone
      /^[A-Z\s]{20,}$/, // All caps long strings
      /Technologies|Utilisees|Spring|Boot|Security|MySQL|Framework|JPA|Repository/i,
    ];

    let searchEndLine = 40;
    
    // Find where contact info appears to limit search
    if (email || phone) {
      const contactLine = lines.findIndex(l => 
        (email && l.toLowerCase().includes(email.toLowerCase())) || 
        (phone && l.includes(phone))
      );
      if (contactLine > 10) searchEndLine = contactLine;
    }

    // Phase 1: Strict ALL CAPS full name pattern (common in CVs)
    // Looking for: "Y O U N E S  D A R R A S S I" or "YOUNES DARRASSI"
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const line = lines[i].trim();
      
      if (!line || line.length < 5 || line.length > 100) continue;
      if (excludePatterns.some(p => p.test(line))) continue;
      
      // Check for spaced out caps: "Y O U N E S  D A R R A S S I"
      const spacedCapsMatch = line.match(/^([A-ZÀÂÄÆÇÉÈÊËÏÎÔÖŒÙÛÜ]\s){2,}[A-ZÀÂÄÆÇÉÈÊËÏÎÔÖŒÙÛÜ]+$/);
      if (spacedCapsMatch) {
        const name = line.replace(/\s+/g, ' ').trim();
        logger.info(`[NAME] Phase 1a - Spaced Caps: "${name}"`);
        return name;
      }
      
      // Check for regular caps: "YOUNES DARRASSI" - convert to title case
      const capsMatch = line.match(/^([A-ZÀÂÄÆÇÉÈÊËÏÎÔÖŒÙÛÜ]+\s){1,3}[A-ZÀÂÄÆÇÉÈÊËÏÎÔÖŒÙÛÜ]+$/);
      if (capsMatch && line === line.toUpperCase()) {
        // Make sure it's not a section header or tech term
        const wordCount = line.split(/\s+/).length;
        if (wordCount >= 2 && wordCount <= 4 && line.length >= 8 && line.length <= 50) {
          // Convert to title case
          const titleCase = line.split(/\s+/).map(word => 
            word.charAt(0) + word.slice(1).toLowerCase()
          ).join(' ');
          logger.info(`[NAME] Phase 1b - All Caps: "${titleCase}"`);
          return titleCase;
        }
      }
    }

    // Phase 2: Strict title case, 2-3 words
    for (let i = 0; i < Math.min(searchEndLine, lines.length); i++) {
      const line = lines[i].trim();
      
      if (!line || line.length < 5 || line.length > 80) continue;
      if (excludePatterns.some(p => p.test(line))) continue;
      if (line === line.toUpperCase() || line === line.toLowerCase()) continue;
      if (line.includes('|') || line.includes(':') || line.includes('/')) continue;

      const strictMatch = line.match(/^([A-ZÀÂÄÆÇÉÈÊËÏÎÔÖŒÙÛÜ][a-zàâäæçéèêëïîôöœùûü]+(?:[\s-][A-ZÀÂÄÆÇÉÈÊËÏÎÔÖŒÙÛÜ][a-zàâäæçéèêëïîôöœùûü]+){1,3})$/);
      
      if (strictMatch && !/\d/.test(line)) {
        const wordCount = line.split(/\s+/).length;
        if (wordCount >= 2 && wordCount <= 4) {
          logger.info(`[NAME] Phase 2 - Strict Title Case: "${line}"`);
          return line;
        }
      }
    }

    // Phase 3: Look near the top but after sections
    const topNonSectionLines = lines.slice(0, 30).filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && 
             !trimmed.match(/^(?:EXPERIENCE|EDUCATION|PROJET|PROJECT|COMPETENCES|SKILLS|CERTIFICATION)/i);
    });

    for (const line of topNonSectionLines) {
      const trimmed = line.trim();
      
      if (trimmed.length < 5 || trimmed.length > 100) continue;
      if (excludePatterns.some(p => p.test(trimmed))) continue;
      
      if (/^[A-ZÀÂÄÆÇÉÈÊËÏÎÔÖŒÙÛÜ]/.test(trimmed) && /[a-z]/.test(trimmed) && /[\s-]/.test(trimmed)) {
        const wordCount = trimmed.split(/\s+/).length;
        if (wordCount >= 2 && wordCount <= 5 && !trimmed.match(/\d{4}/)) {
          // Extra validation: not a sentence (no common French/English words)
          const commonWords = /\b(?:the|a|an|is|are|was|were|le|la|les|un|une|des|et|ou|dans|pour|avec|sur)\b/i;
          if (!commonWords.test(trimmed)) {
            logger.info(`[NAME] Phase 3 - Flexible: "${trimmed}"`);
            return trimmed;
          }
        }
      }
    }

    logger.warn('[NAME] Failed to extract name - using fallback');
    return 'Name Not Found';
  }

  /**
   * Extract position/job title
   */
  private extractPosition(context: ExtractionContext): string {
    const { lines, language } = context;

    const titleKeywords = language.code === 'fr'
      ? ['Développeur', 'Ingénieur', 'Architecte', 'Chef', 'Directeur', 'Consultant', 'Analyste', 'Technicien', 'Responsable', 'Manager']
      : ['Developer', 'Engineer', 'Architect', 'Lead', 'Director', 'Manager', 'Consultant', 'Analyst', 'Specialist', 'Designer'];

    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const line = lines[i].trim();
      
      if (line.includes('|') || titleKeywords.some(kw => line.includes(kw))) {
        if (line.length > 10 && line.length < 200 && !line.includes('@')) {
          logger.debug(`[POSITION] Found: "${line}"`);
          return line;
        }
      }
    }

    return '';
  }

  /**
   * Extract location information
   */
  private extractLocation(context: ExtractionContext): string {
    const { lines } = context;
    const fullText = lines.join('\n');

    // Technology terms that should NOT be considered locations
    const techTerms = [
      'Spring', 'Boot', 'React', 'Angular', 'Node', 'Express', 'Django', 'Flask',
      'Laravel', 'Symfony', 'MySQL', 'MongoDB', 'PostgreSQL', 'Redis', 'Docker',
      'Kubernetes', 'AWS', 'Azure', 'GCP', 'JavaScript', 'TypeScript', 'Python',
      'Java', 'PHP', 'Ruby', 'Security', 'Framework', 'Library'
    ];

    // Common city names in Morocco and worldwide
    const validCities = [
      'Fès', 'Fes', 'Casablanca', 'Rabat', 'Marrakech', 'Tanger', 'Agadir',
      'Mohammedia', 'Oujda', 'Kenitra', 'Tetouan', 'Paris', 'London', 'New York',
      'Dubai', 'Berlin', 'Madrid', 'Rome', 'Amsterdam'
    ];

    // Pattern 1: "City, Country" format
    const cityCountryPattern = /\b([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)?),\s*([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)?)\b/;
    const cityCountryMatch = fullText.match(cityCountryPattern);
    
    if (cityCountryMatch) {
      const city = cityCountryMatch[1].trim();
      const country = cityCountryMatch[2].trim();
      
      // Validate it's not a tech term
      if (!techTerms.some(tech => city.includes(tech) || country.includes(tech))) {
        const location = `${city}, ${country}`;
        logger.debug(`[LOCATION] Found (City, Country): "${location}"`);
        return location;
      }
    }

    // Pattern 2: Look for lines with just city names (top 20 lines)
    const topLines = lines.slice(0, 20);
    for (const line of topLines) {
      const trimmed = line.trim();
      
      // Check if line matches a known city
      const matchedCity = validCities.find(city => 
        trimmed.toLowerCase() === city.toLowerCase()
      );
      
      if (matchedCity) {
        logger.debug(`[LOCATION] Found city: "${matchedCity}"`);
        return matchedCity;
      }
      
      // Pattern: "Location: City" or "Adresse: City"
      const locationLabelMatch = trimmed.match(/(?:Location|Adresse|Address|Ville|City)[\s:]+([A-Za-zÀ-ÿ\s,]+)/i);
      if (locationLabelMatch) {
        const location = locationLabelMatch[1].split('\n')[0].trim(); // Take only first line
        // Validate not a tech term
        if (!techTerms.some(tech => location.includes(tech)) && location.length < 50) {
          logger.debug(`[LOCATION] Found (labeled): "${location}"`);
          return location;
        }
      }
    }

    // Pattern 3: Look in experience/education sections for "l City" pattern
    const locationInSectionPattern = /\bl\s+([A-Z][a-zà-ÿ]+)\b/g;
    let match;
    const candidates: string[] = [];
    
    while ((match = locationInSectionPattern.exec(fullText)) !== null) {
      const candidate = match[1];
      if (!techTerms.includes(candidate) && candidate.length >= 3) {
        candidates.push(candidate);
      }
    }
    
    if (candidates.length > 0) {
      // Return most common location
      const locationCounts = candidates.reduce((acc, loc) => {
        acc[loc] = (acc[loc] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const mostCommon = Object.entries(locationCounts)
        .sort(([, a], [, b]) => b - a)[0];
      
      if (mostCommon) {
        logger.debug(`[LOCATION] Found (from sections): "${mostCommon[0]}"`);
        return mostCommon[0];
      }
    }

    return '';
  }

  /**
   * Extract experience with advanced date parsing
   */
  private extractExperienceAdvanced(context: ExtractionContext): any[] {
    logger.info('[ADVANCED] Extracting experience');

    const section = context.sections.get('experience');
    if (!section) {
      logger.debug('[EXPERIENCE] No experience section found');
      return [];
    }

    const experiences: any[] = [];
    const lines = section.content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Date patterns - more specific to avoid confusion
    const datePatterns = [
      // MM/YYYY - MM/YYYY or MM/YYYY - Present (with boundaries)
      /\b(\d{2})\/(\d{4})\s*[-–—]\s*(?:(\d{2})\/(\d{4})|(?:present|current|aujourd'hui|actuel|now))\b/gi,
      // YYYY - YYYY (with word boundaries to avoid picking up phone numbers)
      /\b(\d{4})\s*[-–—]\s*(?:(\d{4})|(?:present|current|aujourd'hui|actuel|now))\b/gi,
      // Month YYYY - Month YYYY
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)[a-z]*\.?\s+(\d{4})\s*[-–—]\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)[a-z]*\.?\s+)?(\d{4}|present|current|aujourd'hui|actuel)\b/gi,
    ];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      
      // Skip section headers
      if (line.match(/^(?:EXPERIENCE|EXPÉRIENCE|PROFESSIONAL|PARCOURS)/i)) {
        i++;
        continue;
      }

      // Check for dates in current line
      let foundDate = false;
      
      for (const pattern of datePatterns) {
        pattern.lastIndex = 0;
        const dateMatch = pattern.exec(line);
        
        if (dateMatch) {
          foundDate = true;
          let startYear: number;
          let endYear: number | string;

          // Parse based on pattern matched
          if (dateMatch[1] && dateMatch[2]) {
            if (/^\d{4}$/.test(dateMatch[1])) {
              // YYYY - YYYY format
              startYear = parseInt(dateMatch[1]);
              endYear = dateMatch[2]?.toLowerCase().match(/present|current|aujourd'hui|actuel/)
                ? 'Present'
                : parseInt(dateMatch[2]);
            } else if (/^\d{2}$/.test(dateMatch[1])) {
              // MM/YYYY format
              startYear = parseInt(dateMatch[2]);
              endYear = dateMatch[4] || 'Present';
              if (typeof endYear === 'string' && /^\d{4}$/.test(endYear)) {
                endYear = parseInt(endYear);
              }
            } else {
              // Month YYYY format
              startYear = parseInt(dateMatch[2]);
              endYear = dateMatch[4] || 'Present';
              if (typeof endYear === 'string' && /^\d{4}$/.test(endYear)) {
                endYear = parseInt(endYear);
              }
            }
          } else {
            i++;
            continue;
          }

          // Extract position and company from surrounding lines
          let position = '';
          let company = '';
          let location = '';

          // Look backwards for position/company (up to 5 lines)
          for (let j = Math.max(0, i - 5); j < i; j++) {
            const prevLine = lines[j];
            
            // Skip if already processed or looks like description
            if (prevLine.match(/^[-•]/) || prevLine.match(/Technologies|Utilisees|Conception|Développement/i)) {
              continue;
            }

            // Check for pipe-separated format
            if (prevLine.includes('|')) {
              const parts = prevLine.split('|').map(p => p.trim());
              if (!position) position = parts[0] || '';
              if (!company) company = parts[1] || '';
              if (!location) location = parts[2] || '';
              break;
            }

            // Check for company indicator (l Company pattern)
            const companyMatch = prevLine.match(/\bl\s+([A-Z][A-Za-zÀ-ÿ\s]+?)(?:\s*$)/);
            if (companyMatch && !company) {
              company = companyMatch[1].trim();
            }

            // If line looks like a position (not too long, has job keywords)
            if (!position && prevLine.length > 5 && prevLine.length < 150 &&
                !prevLine.match(/\d{4}/) && 
                prevLine.match(/[A-Z]/)) {
              position = prevLine;
            }
          }

          // Extract description from following lines
          let description = '';
          let descLineCount = 0;
          for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
            const descLine = lines[j];
            
            // Stop if we hit another date range or new section
            if (descLine.match(/\d{4}\s*[-–—]\s*\d{4}/) || 
                descLine.match(/^(?:EDUCATION|PROJET|CERTIFICATION|COMPETENCES)/i)) {
              break;
            }

            // Add bullet points and descriptive text
            if (descLine.match(/^[-•]/) || 
                descLine.match(/Technologies|Conception|Développement|Création|Intégration|Implémentation/i)) {
              description += descLine.replace(/^[-•]\s*/, '').trim() + ' ';
              descLineCount++;
            }

            if (descLineCount >= 5) break; // Limit description length
          }

          const duration = typeof endYear === 'number'
            ? `${endYear - startYear} years`
            : `${new Date().getFullYear() - startYear} years`;

          experiences.push({
            position: position || 'Position Not Specified',
            company: company || '',
            location: location || '',
            startDate: startYear.toString(),
            endDate: endYear.toString(),
            description: description.trim(),
            duration,
          });

          logger.debug(`[EXPERIENCE] Extracted: ${position} at ${company} (${startYear} - ${endYear})`);
          break;
        }
      }

      i++;
    }

    logger.info(`[EXPERIENCE] Found ${experiences.length} experience entries`);
    return experiences;
  }

  /**
   * Extract education with advanced parsing
   */
  private extractEducationAdvanced(context: ExtractionContext): any[] {
    logger.info('[ADVANCED] Extracting education');

    const section = context.sections.get('education');
    if (!section) {
      logger.debug('[EDUCATION] No education section found');
      return [];
    }

    const education: any[] = [];
    const lines = section.content.split('\n').filter(l => l.trim());

    const degreeKeywords = context.language.code === 'fr'
      ? ['Ingénieur', 'Master', 'Licence', 'DUT', 'BTS', 'Diplôme', 'Doctorat', 'Bachelor', 'Technicien']
      : ['Engineer', 'Master', 'Bachelor', 'Degree', 'Diploma', 'PhD', 'Doctorate', 'Associate', 'Certificate'];

    const institutionKeywords = ['Université', 'University', 'École', 'School', 'Institut', 'Institute', 'Faculté', 'Faculty', 'College', 'ISTA'];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip section headers
      if (line.match(/^(?:EDUCATION|FORMATION|ÉDUCATION)/i)) continue;

      const hasDegree = degreeKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(line));
      const hasInstitution = institutionKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(line));

      if (hasDegree || hasInstitution) {
        const dateMatch = line.match(/(\d{4})\s*[-–—]\s*(\d{4})/);
        
        let degree = '';
        let institution = '';
        let field = '';

        if (line.includes('|')) {
          const parts = line.split('|').map(p => p.trim());
          degree = parts[0] || line;
          institution = parts[1] || '';
        } else {
          const institutionMatch = line.match(new RegExp(`(${institutionKeywords.join('|')})[^\\d|]*`, 'i'));
          if (institutionMatch) {
            const instIndex = line.indexOf(institutionMatch[0]);
            degree = line.substring(0, instIndex).trim();
            institution = institutionMatch[0].trim();
          } else {
            degree = line;
          }
        }

        education.push({
          degree: degree.replace(/\d{4}\s*[-–—]\s*\d{4}/, '').trim(),
          institution: institution.replace(/\d{4}\s*[-–—]\s*\d{4}/, '').trim(),
          field_of_study: field || null,
          start_date: dateMatch ? dateMatch[1] : null,
          end_date: dateMatch ? dateMatch[2] : null,
        });

        logger.debug(`[EDUCATION] Found: ${degree} at ${institution}`);
      }
    }

    return education;
  }

  /**
   * Extract skills with categorization
   */
  private extractSkillsAdvanced(context: ExtractionContext): string[] {
    logger.info('[ADVANCED] Extracting skills');

    const section = context.sections.get('skills');
    const fullText = context.lines.join('\n');
    
    const skillDatabase = [
      // Programming Languages
      'JavaScript', 'TypeScript', 'Python', 'Java', 'C\\+\\+', 'C#', 'PHP', 'Ruby', 'Go', 'Rust', 
      'Kotlin', 'Swift', 'Scala', 'Dart', 'R', 'MATLAB', 'Perl', 'Objective-C',
      
      // Frontend Frameworks & Libraries
      'React', 'Angular', 'Vue\\.js', 'Svelte', 'Next\\.js', 'Nuxt', 'Gatsby', 'Ember', 
      'Backbone', 'jQuery', 'Redux', 'MobX', 'Vuex',
      
      // Backend Frameworks
      'Node\\.js', 'Express', 'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot', 
      'Laravel', 'Symfony', 'ASP\\.NET', 'Rails', 'Ruby on Rails', 'Gin', 'Echo',
      
      // Databases
      'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Elasticsearch', 'Firebase', 
      'DynamoDB', 'Oracle', 'SQL Server', 'MariaDB', 'Cassandra', 'Neo4j', 
      'SQLite', 'CouchDB', 'Hibernate', 'Sequelize', 'Mongoose', 'Doctrine', 
      'TypeORM', 'Prisma', 'Knex',
      
      // Cloud & DevOps
      'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker', 'Kubernetes', 'Jenkins', 
      'GitLab CI', 'GitHub Actions', 'CircleCI', 'Travis CI', 'Terraform', 
      'Ansible', 'Chef', 'Puppet', 'Vagrant',
      
      // Frontend Technologies
      'HTML', 'HTML5', 'CSS', 'CSS3', 'SCSS', 'SASS', 'Less', 'Tailwind CSS', 
      'Bootstrap', 'Material-UI', 'Ant Design', 'Chakra UI', 'Styled Components',
      
      // Mobile Development
      'React Native', 'Flutter', 'Ionic', 'Xamarin', 'Swift', 'Kotlin', 
      'Android', 'iOS', 'SwiftUI',
      
      // APIs & Protocols
      'REST', 'RESTful', 'GraphQL', 'gRPC', 'WebSocket', 'SOAP', 'API',
      
      // Testing
      'Jest', 'Mocha', 'Jasmine', 'Cypress', 'Selenium', 'JUnit', 'PyTest', 
      'TestNG', 'Karma', 'Protractor',
      
      // Version Control & Tools
      'Git', 'GitHub', 'GitLab', 'Bitbucket', 'SVN', 'Mercurial',
      
      // Project Management & Methodologies
      'Agile', 'Scrum', 'Kanban', 'Jira', 'Trello', 'Asana', 'Confluence',
      
      // Other Technologies
      'Microservices', 'Serverless', 'Lambda', 'CI/CD', 'Machine Learning', 
      'Deep Learning', 'TensorFlow', 'PyTorch', 'NLP', 'Data Science', 
      'Big Data', 'Hadoop', 'Spark', 'Kafka',
      
      // Design & Tools
      'Figma', 'Sketch', 'Adobe XD', 'Photoshop', 'Illustrator', 'InVision',
      
      // French Keywords
      'Développement', 'Programmation', 'Base de données', 'Gestion de projet',
      'Méthodologie Agile', 'Intégration continue',
    ];

    const skills = new Set<string>();

    // Extract from skills section
    if (section) {
      skillDatabase.forEach(skill => {
        const regex = new RegExp(`\\b${skill}\\b`, 'i');
        if (regex.test(section.content)) {
          skills.add(skill.replace(/\\/g, ''));
        }
      });
    }

    // Extract from full text (for skills mentioned in experience/projects)
    skillDatabase.forEach(skill => {
      const regex = new RegExp(`\\b${skill}\\b`, 'i');
      if (regex.test(fullText)) {
        skills.add(skill.replace(/\\/g, ''));
      }
    });

    const skillArray = Array.from(skills);
    logger.info(`[SKILLS] Extracted ${skillArray.length} skills`);
    
    return skillArray;
  }

  /**
   * Extract languages
   */
  private extractLanguagesAdvanced(context: ExtractionContext): string[] {
    logger.info('[ADVANCED] Extracting languages');

    // Try to find dedicated language section first
    const section = context.sections.get('languages');
    let searchText = section ? section.content : context.lines.join('\n');

    // If no language section found, search entire document
    if (!section) {
      logger.debug('[LANGUAGES] No dedicated language section, searching full document');
    }

    const languageNames = {
      en: ['English', 'French', 'Spanish', 'German', 'Arabic', 'Chinese', 'Japanese', 
           'Portuguese', 'Italian', 'Dutch', 'Russian', 'Korean', 'Turkish', 'Hindi',
           'Urdu', 'Bengali', 'Punjabi', 'Vietnamese', 'Polish', 'Ukrainian', 'Romanian'],
      fr: ['Anglais', 'Français', 'Espagnol', 'Allemand', 'Arabe', 'Chinois', 'Japonais',
           'Portugais', 'Italien', 'Néerlandais', 'Russe', 'Coréen', 'Turc', 'Hindi',
           'Ourdou', 'Bengali', 'Pendjabi', 'Vietnamien', 'Polonais', 'Ukrainien', 'Roumain'],
    };

    const allLanguageNames = [...languageNames.en, ...languageNames.fr];
    const languages = new Set<string>();

    // Look for language proficiency patterns
    const proficiencyPattern = /\b(English|French|Spanish|German|Arabic|Chinese|Japanese|Portuguese|Italian|Dutch|Russian|Korean|Turkish|Hindi|Anglais|Français|Espagnol|Allemand|Arabe|Chinois|Japonais|Portugais|Italien|Néerlandais|Russe|Coréen|Turc)\b/gi;
    
    let match;
    while ((match = proficiencyPattern.exec(searchText)) !== null) {
      const lang = match[1];
      // Normalize to English name lowercase
      const normalizedLang = lang.toLowerCase();
      
      // Map French to English
      const langMap: Record<string, string> = {
        'anglais': 'english',
        'français': 'french',
        'espagnol': 'spanish',
        'allemand': 'german',
        'arabe': 'arabic',
        'chinois': 'chinese',
        'japonais': 'japanese',
        'portugais': 'portuguese',
        'italien': 'italian',
        'néerlandais': 'dutch',
        'russe': 'russian',
        'coréen': 'korean',
        'turc': 'turkish',
      };

      const finalLang = langMap[normalizedLang] || normalizedLang;
      
      if (!languages.has(finalLang)) {
        languages.add(finalLang);
        logger.debug(`[LANGUAGES] Found: ${finalLang}`);
      }
    }

    const languageArray = Array.from(languages);
    logger.info(`[LANGUAGES] Found ${languageArray.length} languages`);
    return languageArray;
  }

  /**
   * Extract certifications
   */
  private extractCertificationsAdvanced(context: ExtractionContext): any[] {
    logger.info('[ADVANCED] Extracting certifications');

    const section = context.sections.get('certifications');
    if (!section) {
      logger.debug('[CERTIFICATIONS] No certification section found');
      return [];
    }

    const certifications: any[] = [];
    const lines = section.content.split('\n').filter(l => l.trim());

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.match(/^(?:CERTIFICATIONS?|CERTIFICATS?)/i) || trimmed.length === 0) {
        continue;
      }

      if (trimmed.match(/^[-•]/)) {
        const cert = trimmed.replace(/^[-•]\s*/, '').trim();
        
        // Skip education entries
        if (cert.match(/^(?:BACHELOR|MASTER|ENGINEER|INGÉNIEUR|LICENCE|DEGREE|DIPLOMA|UNIVERSITY|UNIVERSITÉ)/i)) {
          continue;
        }

        if (cert.length > 3 && cert.length < 300) {
          const dateMatch = cert.match(/(\d{4})/);
          
          certifications.push({
            name: cert.replace(/\d{4}/, '').trim(),
            issuer: '',
            date: dateMatch ? dateMatch[1] : '',
          });

          logger.debug(`[CERTIFICATION] Found: ${cert}`);
        }
      }
    }

    return certifications;
  }

  /**
   * Extract projects
   */
  private extractProjectsAdvanced(context: ExtractionContext): any[] {
    logger.info('[ADVANCED] Extracting projects');

    const section = context.sections.get('projects');
    if (!section) {
      logger.debug('[PROJECTS] No project section found');
      return [];
    }

    const projects: any[] = [];
    const lines = section.content.split('\n');

    let currentProject = '';
    let currentDescription = '';
    let currentDate = '';

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (!trimmed || trimmed.match(/^(?:PROJETS?|PROJECTS?)/i)) continue;

      // Check for date
      const dateMatch = trimmed.match(/(\d{4})/);
      if (dateMatch) {
        if (currentProject) {
          projects.push({
            name: currentProject,
            description: currentDescription.trim(),
            date: currentDate,
          });
        }
        
        currentDate = dateMatch[1];
        currentProject = trimmed.replace(/\d{4}/, '').replace(/[-•]/, '').trim();
        currentDescription = '';
      } else if (trimmed.match(/^[-•]/)) {
        if (currentProject && currentDescription) {
          projects.push({
            name: currentProject,
            description: currentDescription.trim(),
            date: currentDate,
          });
          currentProject = '';
          currentDescription = '';
        }
        currentDescription += trimmed.replace(/^[-•]\s*/, '') + ' ';
      } else if (currentProject) {
        currentDescription += trimmed + ' ';
      }
    }

    if (currentProject) {
      projects.push({
        name: currentProject,
        description: currentDescription.trim(),
        date: currentDate,
      });
    }

    logger.info(`[PROJECTS] Found ${projects.length} projects`);
    return projects;
  }

  /**
   * Calculate confidence score based on extraction quality
   */
  private calculateConfidenceScore(personalInfo: any, experience: any[], education: any[], skills: string[]): number {
    let score = 0;

    if (personalInfo.full_name && personalInfo.full_name !== 'Name Not Found') score += 0.2;
    if (personalInfo.email) score += 0.15;
    if (personalInfo.phone) score += 0.1;
    if (experience.length > 0) score += 0.25;
    if (education.length > 0) score += 0.15;
    if (skills.length > 5) score += 0.15;

    return Math.min(score, 0.95);
  }

  /**
   * Estimate seniority with context awareness
   */
  private estimateSeniority(years: number, experience: any[], education: any[]): string {
    const hasAdvancedDegree = education.some(e => 
      e.degree?.match(/master|phd|doctorate|ingénieur/i)
    );

    const hasLeadRole = experience.some(e =>
      e.position?.match(/lead|senior|principal|architect|chief|director/i)
    );

    if (years === 0 && education.length === 0) return 'Entry Level';
    if (years < 2 && !hasAdvancedDegree) return 'Junior';
    if (years < 5) return hasLeadRole ? 'Mid-Senior' : 'Mid Level';
    if (years < 10) return hasLeadRole ? 'Senior' : 'Mid-Senior';
    return 'Lead/Principal';
  }

  /**
   * Detect industry from skills and experience
   */
  private detectIndustry(skills: string[], experience: any[]): string {
    const skillText = skills.join(' ').toLowerCase();
    const experienceText = experience.map(e => e.description).join(' ').toLowerCase();
    const combined = skillText + ' ' + experienceText;

    const industries = {
      'Software Development': ['react', 'angular', 'node', 'python', 'java', 'developer', 'software'],
      'Data Science': ['machine learning', 'data science', 'tensorflow', 'pytorch', 'nlp', 'analytics'],
      'DevOps': ['docker', 'kubernetes', 'aws', 'azure', 'terraform', 'jenkins', 'ci/cd'],
      'Mobile Development': ['react native', 'flutter', 'ios', 'android', 'mobile'],
      'Web Development': ['html', 'css', 'javascript', 'frontend', 'backend', 'full stack'],
      'Cloud Computing': ['aws', 'azure', 'gcp', 'cloud', 'serverless', 'lambda'],
    };

    let maxScore = 0;
    let detectedIndustry = '';

    Object.entries(industries).forEach(([industry, keywords]) => {
      const score = keywords.filter(kw => combined.includes(kw)).length;
      if (score > maxScore) {
        maxScore = score;
        detectedIndustry = industry;
      }
    });

    return detectedIndustry;
  }

  /**
   * Generate advanced summary
   */
  private generateAdvancedSummary(data: CVExtractionResult): string {
    const parts: string[] = [];
    const info = data.personal_info;

    if (info.full_name && info.full_name !== 'Name Not Found') {
      parts.push(`${info.full_name}`);
    }

    if (info.position) {
      parts.push(`working as ${info.position}`);
    } else if (data.metadata.seniority_level !== 'Entry Level') {
      parts.push(`${data.metadata.seniority_level} professional`);
    }

    if (data.metadata.industry) {
      parts.push(`in ${data.metadata.industry}`);
    }

    const summary = parts.join(' ');

    const details: string[] = [];
    
    if (data.experience.length > 0) {
      details.push(`${data.experience.length} professional experience(s)`);
    }

    if (data.education.length > 0) {
      details.push(`${data.education.length} educational qualification(s)`);
    }

    if (data.skills.length > 0) {
      const topSkills = data.skills.slice(0, 6).join(', ');
      details.push(`Skilled in: ${topSkills}`);
    }

    if (data.languages.length > 0) {
      details.push(`Languages: ${data.languages.join(', ')}`);
    }

    return `${summary}. ${details.join('. ')}.`;
  }

  /**
   * Reprocess CV
   */
  async reprocessCV(cvId: string, llmConfig?: LLMConfiguration, llmEnabled: boolean = true): Promise<CVProcessingResult> {
    const cv = await CV.findByPk(cvId);
    
    if (!cv) {
      throw new Error('CV not found');
    }

    if (!cv.googleDriveFileId) {
      throw new Error('CV file not found in storage');
    }

    const fileBuffer = await this.driveService.downloadFile(cv.googleDriveFileId);
    const tempPath = `/tmp/cv_${cv.id}_${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, fileBuffer);

    await cv.update({
      status: CVStatus.PENDING,
      processingError: undefined,
    });

    await CVExtractedData.destroy({ where: { cvId: cv.id } });

    return this.processCV(cv, tempPath, llmConfig, llmEnabled);
  }

  private async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private getMimeType(documentType: string): string {
    switch (documentType) {
      case 'PDF': return 'application/pdf';
      case 'DOCX': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'IMAGE': return 'image/jpeg';
      default: return 'application/octet-stream';
    }
  }

  private isTechnicalSkill(skill: string): boolean {
    const technicalPatterns = [
      /javascript|typescript|python|java|c\+\+|ruby|go|rust|php|swift|kotlin/i,
      /react|angular|vue|node|express|django|flask|spring|rails/i,
      /sql|mongodb|postgresql|mysql|redis|elasticsearch/i,
      /aws|azure|gcp|docker|kubernetes|terraform/i,
      /html|css|sass|less|tailwind|bootstrap/i,
      /git|linux|unix|bash|shell/i,
      /api|rest|graphql|grpc|websocket/i,
      /machine learning|deep learning|nlp|ai|data science/i,
    ];
    return technicalPatterns.some(pattern => pattern.test(skill));
  }

  private isSoftSkill(skill: string): boolean {
    const softPatterns = [
      /communication|leadership|teamwork|collaboration/i,
      /problem.?solving|critical thinking|analytical/i,
      /time management|organization|planning/i,
      /adaptability|flexibility|creativity/i,
      /presentation|public speaking|negotiation/i,
    ];
    return softPatterns.some(pattern => pattern.test(skill));
  }

  private isToolSkill(skill: string): boolean {
    const toolPatterns = [
      /jira|confluence|trello|asana|notion/i,
      /figma|sketch|adobe|photoshop|illustrator/i,
      /vs code|intellij|eclipse|vim|emacs/i,
      /slack|teams|zoom|discord/i,
      /excel|word|powerpoint|google sheets/i,
    ];
    return toolPatterns.some(pattern => pattern.test(skill));
  }

  private validateExtractedText(
    text: string | undefined | null,
    documentType: string
  ): { isValid: boolean; reason?: string; quality: 'high' | 'medium' | 'low' } {
    if (!text) {
      return { isValid: false, reason: 'No text extracted', quality: 'low' };
    }

    const textLength = text.length;
    const wordCount = this.countMeaningfulWords(text);
    const lineCount = text.split('\n').length;

    const isScannedPDF = documentType === 'PDF' && lineCount > 20;

    if (documentType === 'PDF') {
      if (textLength < 30 && wordCount < 5) {
        return { isValid: false, reason: 'PDF text too short', quality: 'low' };
      }
      if (isScannedPDF && textLength >= 20 && wordCount >= 3) {
        return { isValid: true, quality: 'medium' };
      }
    }

    if (textLength < 50 && wordCount < 8) {
      return { isValid: false, reason: 'Text too short', quality: 'low' };
    }

    let quality: 'high' | 'medium' | 'low' = 'low';
    if (textLength >= 500 && wordCount >= 80) {
      quality = 'high';
    } else if (textLength >= 100 && wordCount >= 15) {
      quality = 'medium';
    }

    return { isValid: true, quality };
  }

  private calculateExperienceYears(experience: any[]): number {
    if (!experience || experience.length === 0) return 0;
    
    let totalYears = 0;
    const currentYear = new Date().getFullYear();

    experience.forEach(exp => {
      try {
        const start = parseInt(exp.startDate);
        let end: number;

        if (exp.endDate === 'Present' || exp.endDate.toLowerCase() === 'present') {
          end = currentYear;
        } else {
          end = parseInt(exp.endDate);
        }

        if (!isNaN(start) && !isNaN(end) && end >= start) {
          totalYears += (end - start);
        }
      } catch (e) {
        logger.debug(`[EXPERIENCE] Failed to parse dates for experience: ${e}`);
      }
    });
    
    return totalYears;
  }

  private countMeaningfulWords(text: string): number {
    const words = text
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(word => word.length > 2);

    return words.length;
  }
}

let cvProcessorService: CVProcessorService | null = null;

export function getCVProcessorService(): CVProcessorService {
  if (!cvProcessorService) {
    cvProcessorService = new CVProcessorService();
  }
  return cvProcessorService;
}

export { CVProcessorService };