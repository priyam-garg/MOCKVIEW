import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db, isDatabaseUnreachable } from '@/lib/db';
import { resumeOptimizationSchema } from '@/lib/schemas/resume';

function buildOptimizePrompt(
    resumeText: string,
    targetRole: string,
    weakSections: string[],
    improvementTitles: string[]
): string {
    return `You are an expert resume writer helping a candidate improve their resume for the role: "${targetRole}".

Below is their resume text, followed by the weak areas an ATS analysis already identified.

RESUME TEXT:
---
${resumeText}
---

WEAK SECTIONS (lowest-scoring): ${weakSections.join(', ') || 'none flagged'}
FLAGGED IMPROVEMENTS: ${improvementTitles.join('; ') || 'none flagged'}

For each of the 3-8 weakest or most improvable lines/bullets in the resume, produce a rewrite that:
1. Stays grounded in what the candidate actually did — never invent employers, metrics, or accomplishments they didn't state.
2. Uses stronger action verbs and, where the original already implies a measurable result, makes it explicit.
3. Naturally works in role-relevant keywords for "${targetRole}" where truthful to do so.
4. If a genuinely weak or missing element can't be fixed by rewriting alone (e.g., no metrics given at all), say so in "issue" and still produce the best possible rewrite, using a bracketed placeholder like "[quantify impact]" for anything the candidate must fill in themselves.

For "original", quote the closest matching line from the resume text verbatim (or null if this is a suggestion to add something new, like a missing summary).`;
}

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user || !(session.user as { id?: string }).id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const userId = (session.user as { id: string }).id;

        const { analysisId } = await req.json();
        if (!analysisId || typeof analysisId !== 'string') {
            return NextResponse.json({ error: 'analysisId is required' }, { status: 400 });
        }

        let analysis;
        try {
            analysis = await db.resumeAnalysis.findFirst({
                where: { id: analysisId, userId }, // scoped to the requester — no IDOR
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

        if (!analysis) {
            return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
        }
        if (!analysis.resumeText) {
            return NextResponse.json(
                { error: 'This analysis predates resume-text storage — please re-run the analysis first.' },
                { status: 400 }
            );
        }

        const sectionScores = (analysis.sectionScores as { label: string; score: number }[]) || [];
        const improvements = (analysis.improvements as { title: string }[]) || [];
        const weakSections = sectionScores
            .filter((s) => s.score < 70)
            .sort((a, b) => a.score - b.score)
            .map((s) => s.label);

        let object;
        try {
            ({ object } = await generateObject({
                model: google('gemini-3.6-flash'),
                schema: resumeOptimizationSchema,
                prompt: buildOptimizePrompt(
                    analysis.resumeText.slice(0, 15000),
                    analysis.targetRole || 'General',
                    weakSections,
                    improvements.map((i) => i.title)
                ),
            }));
        } catch (error) {
            console.error('AI Auto-Optimize generation failed:', error);
            return NextResponse.json(
                { error: 'AI returned an invalid response. Please try again.' },
                { status: 502 }
            );
        }

        return NextResponse.json(object);
    } catch (error) {
        console.error('POST /api/resume/optimize error:', error);
        return NextResponse.json({ error: 'Failed to generate optimization suggestions' }, { status: 500 });
    }
}
