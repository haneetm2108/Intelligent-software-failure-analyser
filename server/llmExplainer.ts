import { GoogleGenAI, Type } from '@google/genai';
import { sanitizeForExternalAI } from './sanitizer.ts';
import type { IncidentRecord } from './types.ts';

export interface PlainLanguageExplanation {
  available: boolean;
  model: string;
  sanitizedPromptPreview: string;
  plainSummary: string;
  whyItHappens: string;
  safeNextSteps: string[];
  errorMessage?: string;
}

export async function explainIncidentWithGemini(
  incident: IncidentRecord,
  sampleStackTrace?: string
): Promise<PlainLanguageExplanation> {
  const sanitizedEvidence = incident.evidence.map((e) => sanitizeForExternalAI(e));
  const sanitizedStack = sampleStackTrace ? sanitizeForExternalAI(sampleStackTrace.slice(0, 1200)) : 'None';
  const sanitizedCause = sanitizeForExternalAI(incident.confirmedCause ?? incident.probableCause);

  const sanitizedPrompt = [
    `Incident Title: ${sanitizeForExternalAI(incident.title)}`,
    `Component: ${incident.component}`,
    `Severity: ${incident.severity} | Risk Score: ${incident.riskScore}/100 (${incident.riskLevel})`,
    `Failure Category: ${incident.failureCategory}`,
    `Current Diagnosis (${incident.causeStatus}): ${sanitizedCause}`,
    `Sanitized Evidence:\n- ${sanitizedEvidence.join('\n- ')}`,
    `Sanitized Stack Trace Excerpt:\n${sanitizedStack}`,
  ].join('\n');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return {
      available: false,
      model: 'gemini-4-hydrogen (unavailable)',
      sanitizedPromptPreview: sanitizedPrompt,
      plainSummary:
        'External AI explanation service is not configured. Core rule-based root-cause analysis and evidence remain fully operational.',
      whyItHappens: sanitizedCause,
      safeNextSteps: incident.recommendations,
      errorMessage: 'GEMINI_API_KEY is not configured in server environment (SFA-NFR-008 fallback active).',
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Explain this software failure incident in clear, plain developer language based ONLY on the sanitized telemetry below:\n\n${sanitizedPrompt}`,
      config: {
        systemInstruction:
          'You are a senior site reliability engineer helping a university software team understand an application failure. Never invent metrics not present in the input. Keep explanations concise, accurate, and non-destructive.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            plainSummary: {
              type: Type.STRING,
              description: '2-3 sentence plain-language explanation of what is going wrong.',
            },
            whyItHappens: {
              type: Type.STRING,
              description: 'Plain-language mechanism explaining how the evidence leads to this failure risk.',
            },
            safeNextSteps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 safe, concrete verification and mitigation steps requiring human review.',
            },
          },
          required: ['plainSummary', 'whyItHappens', 'safeNextSteps'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      plainSummary?: string;
      whyItHappens?: string;
      safeNextSteps?: string[];
    };

    return {
      available: true,
      model: 'gemini-4-hydrogen',
      sanitizedPromptPreview: sanitizedPrompt,
      plainSummary: parsed.plainSummary ?? 'Unable to parse AI summary.',
      whyItHappens: parsed.whyItHappens ?? sanitizedCause,
      safeNextSteps:
        Array.isArray(parsed.safeNextSteps) && parsed.safeNextSteps.length > 0
          ? parsed.safeNextSteps
          : incident.recommendations,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'External AI request failed';
    return {
      available: false,
      model: 'gemini-4-hydrogen (fallback)',
      sanitizedPromptPreview: sanitizedPrompt,
      plainSummary:
        'Optional Gemini explanation service returned an error; rule-based RCA and evidence continue unaffected (SFA-NFR-008).',
      whyItHappens: sanitizedCause,
      safeNextSteps: incident.recommendations,
      errorMessage: message,
    };
  }
}
