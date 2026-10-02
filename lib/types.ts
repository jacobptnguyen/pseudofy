import { z } from "zod";

export type Difficulty = "easy" | "medium" | "hard";
export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

/** Starter text for every file on easy. Untouched copies are sent to the grader as empty. */
export const TEMPLATE = "Purpose:\n\nImports and exports:\n\nUsed by:\n";

export type GradeRequest = { repoUrl: string; files: Record<string, string>; difficulty?: Difficulty };

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
export const HintsSchema = z.object({ hints: z.array(z.object({ path: z.string(), hint: z.string() })) });
export type TreeResponse = { paths: string[]; hints?: Record<string, string> };
export type GradeError = { error: string };
