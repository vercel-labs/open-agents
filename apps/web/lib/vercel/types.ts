import { z } from "zod";

const nullableTrimmedString = z.string().trim().min(1).nullable();

export const vercelProjectSelectionSchema = z.object({
  projectId: z.string().trim().min(1),
  projectName: z.string().trim().min(1),
  teamId: nullableTrimmedString,
  teamSlug: nullableTrimmedString,
});

export type VercelProjectSelection = z.infer<
  typeof vercelProjectSelectionSchema
>;

export const vercelRepoProjectsResponseSchema = z.object({
  projects: z.array(vercelProjectSelectionSchema),
  selectedProjectId: nullableTrimmedString,
});

export type VercelRepoProjectsResponse = z.infer<
  typeof vercelRepoProjectsResponseSchema
>;
