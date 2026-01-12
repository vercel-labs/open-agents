import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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

export const tasks = pgTable("tasks", {
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
  // Whether this task uses a new auto-generated branch
  isNewBranch: boolean("is_new_branch").default(false).notNull(),
  // Sandbox info
  sandboxId: text("sandbox_id"),
  // Git stats (for display in task list)
  linesAdded: integer("lines_added").default(0),
  linesRemoved: integer("lines_removed").default(0),
  // PR info if created
  prNumber: integer("pr_number"),
  prStatus: text("pr_status", {
    enum: ["open", "merged", "closed"],
  }),
  // Snapshot info
  snapshotUrl: text("snapshot_url"),
  snapshotCreatedAt: timestamp("snapshot_created_at"),
  snapshotSizeBytes: integer("snapshot_size_bytes"),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const taskMessages = pgTable("task_messages", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["user", "assistant"],
  }).notNull(),
  // Store the full message parts as JSON for flexibility
  parts: jsonb("parts").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskMessage = typeof taskMessages.$inferSelect;
export type NewTaskMessage = typeof taskMessages.$inferInsert;
