import { z } from 'zod';

// Shared zod schemas for the resume-analysis AI calls. Using generateObject
// with these (instead of generateText + manual JSON.parse) means malformed
// or out-of-range model output is rejected with a typed validation error
// instead of silently corrupting the UI or crashing on JSON.parse.

export const resumeAnalysisSchema = z.object({
    atsScore: z.number().min(0).max(100),
    keywordData: z
        .array(
            z.object({
                keyword: z.string(),
                count: z.number().min(0),
                relevance: z.number().min(0).max(100),
                found: z.boolean(),
            })
        )
        .min(1),
    sectionScores: z
        .array(
            z.object({
                label: z.string(),
                score: z.number().min(0).max(100),
            })
        )
        .min(1),
    improvements: z
        .array(
            z.object({
                severity: z.enum(['critical', 'warning', 'suggestion']),
                title: z.string(),
                description: z.string(),
            })
        )
        .min(1),
});

export type ResumeAnalysisData = z.infer<typeof resumeAnalysisSchema>;

export const resumeOptimizationSchema = z.object({
    suggestions: z
        .array(
            z.object({
                section: z.string(),
                issue: z.string(),
                original: z.string().nullable(),
                rewritten: z.string(),
            })
        )
        .min(1)
        .max(8),
});

export type ResumeOptimizationData = z.infer<typeof resumeOptimizationSchema>;
