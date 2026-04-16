import { and, eq, inArray, lt } from "drizzle-orm";
import { generateId } from "ai";
import { db } from "./client";
import {
  mcpConnections,
  mcpOAuthStates,
  type MCPConnection,
  type NewMCPConnection,
  type MCPOAuthState,
  type NewMCPOAuthState,
} from "./schema";

// ── Connection CRUD ─────────────────────────────────────────────────────────

export async function getUserMCPConnections(
  userId: string,
): Promise<MCPConnection[]> {
  return db
    .select()
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, userId))
    .orderBy(mcpConnections.createdAt);
}

export async function getMCPConnectionById(
  id: string,
  userId: string,
): Promise<MCPConnection | null> {
  const [connection] = await db
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.userId, userId)))
    .limit(1);
  return connection ?? null;
}

export async function createMCPConnection(
  data: Omit<NewMCPConnection, "id">,
): Promise<MCPConnection> {
  const id = generateId();
  const [connection] = await db
    .insert(mcpConnections)
    .values({ ...data, id })
    .returning();
  return connection;
}

export async function updateMCPConnection(
  id: string,
  userId: string,
  data: Partial<Omit<NewMCPConnection, "id" | "userId">>,
): Promise<void> {
  await db
    .update(mcpConnections)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.userId, userId)));
}

export async function deleteMCPConnection(
  id: string,
  userId: string,
): Promise<void> {
  await db
    .delete(mcpConnections)
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.userId, userId)));
}

// ── Runtime Resolution ──────────────────────────────────────────────────────

export async function getEnabledMCPConnections(
  userId: string,
  connectionIds: string[],
): Promise<MCPConnection[]> {
  if (connectionIds.length === 0) return [];
  return db
    .select()
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.userId, userId),
        inArray(mcpConnections.id, connectionIds),
      ),
    );
}

// ── Token Updates ───────────────────────────────────────────────────────────

export async function updateMCPConnectionTokens(
  id: string,
  userId: string,
  tokens: {
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
  },
): Promise<void> {
  await db
    .update(mcpConnections)
    .set({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.tokenExpiresAt,
      status: "active",
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.userId, userId)));
}

export async function updateMCPConnectionStatus(
  id: string,
  userId: string,
  status: "active" | "needs_auth" | "error" | "unchecked",
  lastError?: string,
): Promise<void> {
  await db
    .update(mcpConnections)
    .set({
      status,
      lastError: lastError ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.userId, userId)));
}

// ── OAuth State ─────────────────────────────────────────────────────────────

export async function createOAuthState(data: NewMCPOAuthState): Promise<void> {
  await db.insert(mcpOAuthStates).values(data);
}

export async function consumeOAuthState(
  state: string,
): Promise<MCPOAuthState | null> {
  const [row] = await db
    .delete(mcpOAuthStates)
    .where(eq(mcpOAuthStates.state, state))
    .returning();

  if (!row) return null;

  // Check expiry
  if (row.expiresAt.getTime() < Date.now()) {
    return null;
  }

  return row;
}

export async function cleanExpiredOAuthStates(): Promise<void> {
  await db
    .delete(mcpOAuthStates)
    .where(lt(mcpOAuthStates.expiresAt, new Date()));
}
