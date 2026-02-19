import { cache } from "react";
import { getSessionById, getSessionByShareId } from "./sessions";

export const getSessionByIdCached = cache(async (sessionId: string) =>
  getSessionById(sessionId),
);

export const getSessionByShareIdCached = cache(async (shareId: string) =>
  getSessionByShareId(shareId),
);
