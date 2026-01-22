/**
 * LLM Prompt Templates for CV Extraction and Analysis
 */

export const CV_EXTRACTION_SYSTEM_PROMPT = `You are an expert CV/Resume parser and data extraction specialist. Your task is to extract structured information from CV documents with high accuracy.

CRITICAL RULES:
1. Extract ONLY information explicitly stated in the CV - NEVER make assumptions or infer data
2. If information is not clearly stated, use null for that field
3. Normalize all dates to ISO format (YYYY-MM-DD) or partial format (YYYY-MM or YYYY)
4. Remove duplicates from skills lists
5. Categorize skills into three distinct categories:
   - technical: Programming languages, frameworks, databases, technical competencies
   - soft: Communication, leadership, teamwork, problem-solving, etc.
   - tools: IDEs, software applications, platforms, development tools
6. Map language proficiency to standard levels: Native, Fluent, Advanced, Intermediate, Basic
7. Calculate total experience by summing all work experience durations
8. Determine seniority level based on total experience:
   - Entry/Junior: 0-2 years
   - Mid-level: 2-5 years  
   - Senior: 5-10 years
   - Lead/Principal: 10+ years
9. Extract keywords relevant for job matching and search

OUTPUT FORMAT:
Return ONLY valid JSON matching the exact schema provided. No explanations, no markdown, no additional text.`;

export const CV_EXTRACTION_USER_PROMPT = `Extract structured data from the following CV text and return it as JSON.

CV TEXT:
---
{cv_text}
---

Return ONLY a valid JSON object with this exact structure:

{
  "personal_info": {
    "full_name": "string or null",
    "email": "string or null",
    "phone": "string or null",
    "location": "string or null (full address)",
    "city": "string or null",
    "country": "string or null",
    "age": "number or null",
    "gender": "string or null"
  },
  "education": [
    {
      "degree": "string",
      "institution": "string",
      "field_of_study": "string or null",
      "start_date": "YYYY-MM-DD or YYYY-MM or YYYY or null",
      "end_date": "YYYY-MM-DD or YYYY-MM or YYYY or null",
      "description": "string or null"
    }
  ],
  "experience": [
    {
      "job_title": "string",
      "company": "string",
      "start_date": "YYYY-MM-DD or YYYY-MM or YYYY or null",
      "end_date": "YYYY-MM-DD or YYYY-MM or YYYY or 'Present' or null",
      "responsibilities": ["string array"],
      "achievements": ["string array"],
      "location": "string or null"
    }
  ],
  "skills": {
    "technical": ["array of technical/hard skills like programming languages, frameworks, databases"],
    "soft": ["array of soft skills like leadership, communication, teamwork"],
    "tools": ["array of tools and technologies like IDEs, software, platforms"]
  },
  "languages": [
    {
      "language": "string",
      "proficiency": "Native|Fluent|Advanced|Intermediate|Basic or null",
      "spoken": "string or null",
      "written": "string or null"
    }
  ],
  "certifications": [
    {
      "name": "string",
      "issuer": "string or null",
      "date": "YYYY-MM-DD or YYYY or null",
      "expiry_date": "YYYY-MM-DD or YYYY or null",
      "credential_id": "string or null"
    }
  ],
  "internships": [
    {
      "title": "string",
      "company": "string",
      "start_date": "YYYY-MM-DD or null",
      "end_date": "YYYY-MM-DD or null",
      "description": "string or null"
    }
  ],
  "metadata": {
    "total_experience_years": "number (calculated from experience)",
    "seniority_level": "Entry|Junior|Mid-level|Senior|Lead|Principal",
    "industry": "string (primary industry based on experience)",
    "keywords": ["relevant keywords for job matching"]
  },
  "photo_detected": false,
  "confidence_score": 0.0
}

Set confidence_score between 0.0 and 1.0 based on:
- 1.0: All major fields clearly extracted
- 0.8: Most fields extracted, some minor uncertainties
- 0.6: Core information extracted, several fields unclear
- 0.4: Limited information extracted
- 0.2: Minimal extraction possible

IMPORTANT: Return ONLY the JSON object, nothing else.`;

export const CV_SUMMARY_SYSTEM_PROMPT = `You are a professional resume writer and career consultant. Your task is to generate concise, recruiter-friendly professional summaries based on extracted CV data.

RULES:
1. Write 4-6 sentences maximum
2. Use professional, neutral tone
3. Highlight key skills, experience level, and domain expertise
4. Do NOT include any information not present in the data
5. Do NOT use first person ("I am...", "I have...")
6. Start with role/title and years of experience
7. End with key value proposition or specialization`;

export const CV_SUMMARY_USER_PROMPT = `Generate a professional summary based on this extracted CV data:

{cv_data}

Write a 4-6 sentence professional summary in third person, highlighting:
- Years of experience and seniority level
- Primary skills and technologies
- Industry expertise
- Key achievements (if available)

Return ONLY the summary text, no quotes or formatting.`;

export const CV_EXTRACTION_ERROR_PROMPT = `The CV text could not be properly parsed. Return ONLY this JSON:

{
  "error": "EXTRACTION_FAILED",
  "reason": "Brief explanation of why extraction failed"
}`;

/**
 * Get extraction prompt with CV text inserted
 */
export function getExtractionPrompt(cvText: string): string {
  return CV_EXTRACTION_USER_PROMPT.replace('{cv_text}', cvText);
}

/**
 * Get summary prompt with CV data inserted
 */
export function getSummaryPrompt(cvData: object): string {
  return CV_SUMMARY_USER_PROMPT.replace('{cv_data}', JSON.stringify(cvData, null, 2));
}

/**
 * Strictness-adjusted prompts
 */
export function getStrictnessInstructions(strictness: 'strict' | 'moderate' | 'lenient'): string {
  switch (strictness) {
    case 'strict':
      return `
STRICTNESS: HIGH
- Only extract information that is 100% certain
- Leave fields null if there's any ambiguity
- Do not infer dates or fill gaps
- Flag any uncertain data in metadata`;
    
    case 'moderate':
      return `
STRICTNESS: MODERATE
- Extract clearly stated information
- Make reasonable inferences for partial dates (e.g., "2020" for incomplete date)
- Use context to resolve minor ambiguities
- Note any inferences in metadata`;
    
    case 'lenient':
      return `
STRICTNESS: LOW
- Extract as much information as possible
- Make reasonable assumptions based on context
- Infer missing data from related fields
- Fill in likely values for common patterns`;
  }
}