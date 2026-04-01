import { z } from "zod";

const GLOBAL_SKILL_SOURCE_PATTERN = /^[^\s/]+\/[^\s/]+$/;
const GLOBAL_SKILL_NAME_PATTERN = /^\S+$/;

export const globalSkillRefSchema = z.object({
  source: z
    .string()
    .trim()
    .min(1, "Source is required")
    .regex(
      GLOBAL_SKILL_SOURCE_PATTERN,
      "Source must be in owner/repo format",
    ),
  skillName: z
    .string()
    .trim()
    .min(1, "Skill name is required")
    .regex(
      GLOBAL_SKILL_NAME_PATTERN,
      "Skill name cannot contain spaces",
    ),
});

export type GlobalSkillRef = z.infer<typeof globalSkillRefSchema>;

function getGlobalSkillRefKey(ref: GlobalSkillRef): string {
  return `${ref.source.toLowerCase()}::${ref.skillName.toLowerCase()}`;
}

export function dedupeGlobalSkillRefs(
  refs: GlobalSkillRef[],
): GlobalSkillRef[] {
  const dedupedRefs: GlobalSkillRef[] = [];
  const seenKeys = new Set<string>();

  for (const ref of refs) {
    const key = getGlobalSkillRefKey(ref);
    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    dedupedRefs.push(ref);
  }

  return dedupedRefs;
}

export const globalSkillRefsSchema = z
  .array(globalSkillRefSchema)
  .transform((refs) => dedupeGlobalSkillRefs(refs));

export function parseGlobalSkillRefs(
  value: unknown,
): GlobalSkillRef[] | null {
  const parsed = globalSkillRefsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function normalizeGlobalSkillRefs(value: unknown): GlobalSkillRef[] {
  return parseGlobalSkillRefs(value) ?? [];
}

export function areGlobalSkillRefsEqual(
  left: GlobalSkillRef[],
  right: GlobalSkillRef[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((ref, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      ref.source === other.source &&
      ref.skillName === other.skillName
    );
  });
}
