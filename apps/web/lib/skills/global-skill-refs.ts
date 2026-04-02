import { z } from "zod";

const GLOBAL_SKILL_SOURCE_PATTERN = /^[^\s/]+\/[^\s/]+$/;
const GLOBAL_SKILL_NAME_PATTERN = /^\S+$/;

export const globalSkillRefSchema = z.object({
  source: z
    .string()
    .trim()
    .min(1, "Source is required")
    .regex(GLOBAL_SKILL_SOURCE_PATTERN, "Source must be in owner/repo format"),
  skillName: z
    .string()
    .trim()
    .min(1, "Skill name is required")
    .regex(GLOBAL_SKILL_NAME_PATTERN, "Skill name cannot contain spaces"),
});

export type GlobalSkillRef = z.infer<typeof globalSkillRefSchema>;

function getGlobalSkillRefKey(ref: GlobalSkillRef): string {
  return `${ref.source.toLowerCase()}::${ref.skillName.toLowerCase()}`;
}

export const globalSkillRefsSchema = z
  .array(globalSkillRefSchema)
  .transform((refs) => {
    const seenKeys = new Set<string>();
    const dedupedRefs: GlobalSkillRef[] = [];

    for (const ref of refs) {
      const key = getGlobalSkillRefKey(ref);
      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      dedupedRefs.push(ref);
    }

    return dedupedRefs;
  });

export function normalizeGlobalSkillRefs(value: unknown): GlobalSkillRef[] {
  const parsed = globalSkillRefsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
