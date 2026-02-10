import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { SandboxState } from "@open-harness/sandbox";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    provider: text("provider", {
      enum: ["github", "vercel"],
    }).notNull(),
    externalId: text("external_id").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    scope: text("scope"),
    username: text("username").notNull(),
    email: text("email"),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_provider_external_id_idx").on(
      table.provider,
      table.externalId,
    ),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["github"],
    })
      .notNull()
      .default("github"),
    externalUserId: text("external_user_id").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at"),
    scope: text("scope"),
    username: text("username").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("accounts_user_id_provider_idx").on(
      table.userId,
      table.provider,
    ),
  ],
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status", {
    enum: ["running", "completed", "failed", "archived"],
  })
    .notNull()
    .default("running"),
  // Repository info
  repoOwner: text("repo_owner"),
  repoName: text("repo_name"),
  branch: text("branch"),
  cloneUrl: text("clone_url"),
  // Whether this session uses a new auto-generated branch
  isNewBranch: boolean("is_new_branch").default(false).notNull(),
  // Unified sandbox state
  sandboxState: jsonb("sandbox_state").$type<SandboxState>(),
  // Lifecycle orchestration state for sandbox management
  lifecycleState: text("lifecycle_state", {
    enum: [
      "provisioning",
      "active",
      "hibernating",
      "hibernated",
      "restoring",
      "archived",
      "failed",
    ],
  }),
  lifecycleVersion: integer("lifecycle_version").notNull().default(0),
  lastActivityAt: timestamp("last_activity_at"),
  sandboxExpiresAt: timestamp("sandbox_expires_at"),
  hibernateAfter: timestamp("hibernate_after"),
  lifecycleRunId: text("lifecycle_run_id"),
  lifecycleError: text("lifecycle_error"),
  // Git stats (for display in session list)
  linesAdded: integer("lines_added").default(0),
  linesRemoved: integer("lines_removed").default(0),
  // PR info if created
  prNumber: integer("pr_number"),
  prStatus: text("pr_status", {
    enum: ["open", "merged", "closed"],
  }),
  // Snapshot info (for cached snapshots feature)
  snapshotUrl: text("snapshot_url"),
  snapshotCreatedAt: timestamp("snapshot_created_at"),
  snapshotSizeBytes: integer("snapshot_size_bytes"),
  // Cached diff for offline viewing
  cachedDiff: jsonb("cached_diff"),
  cachedDiffUpdatedAt: timestamp("cached_diff_updated_at"),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const chats = pgTable("chats", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  modelId: text("model_id").default("anthropic/claude-haiku-4.5"),
  activeStreamId: text("active_stream_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["user", "assistant"],
  }).notNull(),
  // Store the full message parts as JSON for flexibility
  parts: jsonb("parts").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;

// Linked accounts for external platforms (Slack, Discord, etc.)
export const linkedAccounts = pgTable(
  "linked_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["slack", "discord", "whatsapp", "telegram"],
    }).notNull(),
    externalId: text("external_id").notNull(),
    workspaceId: text("workspace_id"), // For Slack workspaces, Discord servers
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("linked_accounts_provider_external_workspace_idx").on(
      table.provider,
      table.externalId,
      table.workspaceId,
    ),
  ],
);

export type LinkedAccount = typeof linkedAccounts.$inferSelect;
export type NewLinkedAccount = typeof linkedAccounts.$inferInsert;

// CLI tokens for device flow authentication
export const cliTokens = pgTable(
  "cli_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    // Encrypted access token - only populated during device flow, cleared after first retrieval
    encryptedAccessToken: text("encrypted_access_token"),
    deviceName: text("device_name"),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    // Device flow fields
    deviceCode: text("device_code"),
    userCode: text("user_code"),
    deviceCodeExpiresAt: timestamp("device_code_expires_at"),
    status: text("status", {
      enum: ["pending", "active", "revoked"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cli_tokens_token_hash_idx").on(table.tokenHash),
    uniqueIndex("cli_tokens_device_code_idx").on(table.deviceCode),
    uniqueIndex("cli_tokens_user_code_idx").on(table.userCode),
  ],
);

export type CliToken = typeof cliTokens.$inferSelect;
export type NewCliToken = typeof cliTokens.$inferInsert;

// User preferences for settings
export const userPreferences = pgTable("user_preferences", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  defaultModelId: text("default_model_id").default(
    "anthropic/claude-haiku-4.5",
  ),
  defaultSandboxType: text("default_sandbox_type", {
    enum: ["hybrid", "vercel", "just-bash"],
  }).default("hybrid"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;
