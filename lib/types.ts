import { z } from "zod";

export type GradeRequest = { repoUrl: string; files: Record<string, string> };

export const GradeResultSchema = z.object({
  overall: z.number().min(0).max(100),
  structure: z.number().min(0).max(100),
  purpose: z.number().min(0).max(100),
  relationships: z.number().min(0).max(100),
  summary: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      status: z.enum(["matched", "misplaced", "nonexistent"]),
      actualPath: z.string().optional(),
      score: z.number().min(0).max(100),
      feedback: z.string(),
    })
  ),
  missed: z.array(z.object({ path: z.string(), why: z.string() })),
});
export type GradeResult = z.infer<typeof GradeResultSchema>;
export type GradeError = { error: string };
