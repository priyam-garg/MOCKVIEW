import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db, isDatabaseUnreachable } from '@/lib/db';
import { extractPdfText } from '@/lib/parsePdf';
import { resumeAnalysisSchema } from '@/lib/schemas/resume';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB — mirrors the client-side check

// ── System prompt for resume ATS analysis ──
function buildPrompt(resumeText: string, targetRole: string): string {
    return `You are an expert ATS (Applicant Tracking System) analyzer and career consultant.

Analyze the following resume text for the target role: "${targetRole}".

Guidelines:
1. keywordData must include 10-15 keywords that are CRITICAL for the "${targetRole}" role. Mark each as found/missing based on whether the resume contains it.
2. sectionScores should evaluate each resume section's completeness and quality for the target role. Use exactly these six labels: "Contact Info", "Summary", "Experience", "Skills", "Education", "Keywords".
3. improvements should include 4-8 actionable items sorted by severity (critical first). These MUST be specific to the "${targetRole}" role, referencing exact skills, tools, or phrasing that would improve ATS pass rates.
4. atsScore is the overall score considering keyword match, section quality, formatting, and role relevance.
5. Be strict but fair. A generic resume with no role-specific keywords should score 30-50.

RESUME TEXT:
---
${resumeText}
---`;
}

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user || !(session.user as { id?: string }).id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const userId = (session.user as { id: string }).id;

        // ── Parse multipart form data ──
        const formData = await req.formData();
        const file = formData.get('resume') as File | null;
        const targetRole = (formData.get('targetRole') as string) || 'General';

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }
        if (file.size > MAX_FILE_BYTES) {
            return NextResponse.json({ error: 'File size must be under 10MB.' }, { status: 400 });
        }

        // ── Extract text from PDF ──
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        let resumeText: string;
        try {
            resumeText = await extractPdfText(buffer);
        } catch (parseErr) {
            console.error('PDF parse error:', parseErr);
            return NextResponse.json(
                { error: 'Failed to parse PDF. Please ensure the file is a valid PDF.' },
                { status: 400 }
            );
        }

        if (!resumeText || resumeText.trim().length < 50) {
            return NextResponse.json(
                { error: 'Could not extract enough text from the PDF. The file may be image-based — please use a text-based PDF.' },
                { status: 400 }
            );
        }

        // ── Call Gemini for ATS analysis ──
        // generateObject + a zod schema (vs. generateText + manual JSON.parse)
        // means malformed/out-of-range model output is rejected with a typed
        // validation error instead of silently corrupting the UI or crashing.
        let analysisData;
        try {
            ({ object: analysisData } = await generateObject({
                model: google('gemini-3.6-flash'),
                schema: resumeAnalysisSchema,
                prompt: buildPrompt(resumeText.slice(0, 15000), targetRole), // Cap at 15k chars
            }));
        } catch (error) {
            console.error('AI resume analysis failed:', error);
            return NextResponse.json(
                { error: 'AI returned an invalid response. Please try again.' },
                { status: 502 }
            );
        }

        // ── Save to database ──
        let saved;
        try {
            saved = await db.resumeAnalysis.create({
                data: {
                    userId,
                    fileName: file.name,
                    targetRole,
                    atsScore: Math.round(analysisData.atsScore),
                    keywordData: analysisData.keywordData,
                    sectionScores: analysisData.sectionScores,
                    improvements: analysisData.improvements,
                    // Stored so the interview flow can personalize questions from
                    // this resume without a second upload.
                    resumeText: resumeText.slice(0, 10000),
                },
            });
        } catch (error) {
            if (isDatabaseUnreachable(error)) {
                return NextResponse.json(
                    { error: "We can't reach the server right now. Please try again in a moment." },
                    { status: 503 }
                );
            }
            throw error;
        }

        return NextResponse.json(saved, { status: 201 });
    } catch (error: unknown) {
        console.error('POST /api/resume/analyze error:', error);
        return NextResponse.json(
            { error: 'Failed to analyze resume' },
            { status: 500 }
        );
    }
}
