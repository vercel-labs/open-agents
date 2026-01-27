# Chat SDK

A unified SDK for building chat bots across Slack, Microsoft Teams, Google Chat, and Discord.

## Features

- Multi-platform support with a single codebase
- Mention-based thread subscriptions
- Reaction handling with type-safe emoji
- Cross-platform emoji helper for consistent rendering
- **AI SDK integration** - Stream LLM responses directly to chat
- **Rich cards with buttons** - TSX or object-based cards
- **Action callbacks** - Handle button clicks across platforms
- **Modals & form inputs** - Collect user input via modal dialogs
- **File uploads** - Send files with messages
- **DM support** - Initiate direct messages programmatically
- Message deduplication for platform quirks
- Serverless-ready with pluggable state backends

## Quick Start

### 1. Create your bot (`lib/bot.ts`)

```typescript
import { Chat, ConsoleLogger, emoji } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createTeamsAdapter } from "@chat-adapter/teams";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { createRedisState } from "@chat-adapter/state-redis";

const logger = new ConsoleLogger("info");

export const bot = new Chat({
  userName: "mybot",
  logger,
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      logger: logger.child("slack"),
    }),
    teams: createTeamsAdapter({
      appId: process.env.TEAMS_APP_ID!,
      appPassword: process.env.TEAMS_APP_PASSWORD!,
      logger: logger.child("teams"),
    }),
    gchat: createGoogleChatAdapter({
      credentials: JSON.parse(process.env.GOOGLE_CHAT_CREDENTIALS!),
      logger: logger.child("gchat"),
    }),
    discord: createDiscordAdapter({
      botToken: process.env.DISCORD_BOT_TOKEN!,
      publicKey: process.env.DISCORD_PUBLIC_KEY!,
      applicationId: process.env.DISCORD_APPLICATION_ID!,
      logger: logger.child("discord"),
    }),
  },
  state: createRedisState({ url: process.env.REDIS_URL!, logger }),
});

// Handle @mentions - works across all platforms
bot.onNewMention(async (thread) => {
  await thread.subscribe();
  // Emoji auto-converts to platform format: :wave: on Slack, 👋 on Teams/GChat
  await thread.post(`${emoji.wave} Hello! I'm now listening to this thread.`);
});

// Handle follow-up messages in subscribed threads
bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`${emoji.check} You said: ${message.text}`);
});

// Handle emoji reactions (type-safe emoji values)
bot.onReaction([emoji.thumbs_up, emoji.heart, emoji.fire], async (event) => {
  if (!event.added) return; // Only respond to added reactions
  await event.adapter.addReaction(event.threadId, event.messageId, event.emoji);
});
```

### 2. Create a webhook handler (`app/api/webhooks/[platform]/route.ts`)

```typescript
import { after } from "next/server";
import { bot } from "@/lib/bot";

type Platform = keyof typeof bot.webhooks;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;

  const handler = bot.webhooks[platform as Platform];
  if (!handler) {
    return new Response(`Unknown platform: ${platform}`, { status: 404 });
  }

  return handler(request, {
    waitUntil: (task) => after(() => task),
  });
}
```

This creates endpoints for each platform:

- `POST /api/webhooks/slack`
- `POST /api/webhooks/teams`
- `POST /api/webhooks/gchat`
- `POST /api/webhooks/discord`

The `waitUntil` option ensures message processing completes after the response is sent (required for serverless).

**Note for Discord:** Discord uses HTTP Interactions for slash commands and button clicks, but requires a Gateway WebSocket connection for receiving messages. See [SETUP.md](./SETUP.md) for Discord Gateway configuration.

## Setup

See [SETUP.md](./SETUP.md) for platform configuration instructions including:

- Slack app creation and OAuth scopes
- Microsoft Teams Azure Bot setup
- Google Chat service account and Pub/Sub configuration
- Discord application and Gateway setup
- Environment variables reference

## Emoji Helper

The `emoji` helper provides type-safe, cross-platform emoji that automatically convert to each platform's format. Use it with `thread.post()`:

```
await thread.post(`${emoji.thumbs_up} Great job!`);
// Slack: ":+1: Great job!"
// Teams/GChat: "👍 Great job!"
```

**Available emoji:**

| Name              | Emoji | Name                | Emoji |
| ----------------- | ----- | ------------------- | ----- |
| `emoji.thumbs_up` | 👍    | `emoji.thumbs_down` | 👎    |
| `emoji.heart`     | ❤️    | `emoji.smile`       | 😊    |
| `emoji.laugh`     | 😂    | `emoji.thinking`    | 🤔    |
| `emoji.eyes`      | 👀    | `emoji.fire`        | 🔥    |
| `emoji.check`     | ✅    | `emoji.x`           | ❌    |
| `emoji.question`  | ❓    | `emoji.party`       | 🎉    |
| `emoji.rocket`    | 🚀    | `emoji.star`        | ⭐    |
| `emoji.wave`      | 👋    | `emoji.clap`        | 👏    |
| `emoji["100"]`    | 💯    | `emoji.warning`     | ⚠️    |

For one-off custom emoji, use `emoji.custom("name")`.

### Custom Emoji (Type-Safe)

For workspace-specific emoji with full type safety, use `createEmoji()`:

```typescript
import { createEmoji } from "chat";

// Create emoji helper with custom emoji
const myEmoji = createEmoji({
  unicorn: { slack: "unicorn_face", gchat: "🦄" },
  company_logo: { slack: "company", gchat: "🏢" },
});

// Type-safe access to custom emoji (with autocomplete)
const message = `${myEmoji.unicorn} Magic! ${myEmoji.company_logo}`;
// Slack: ":unicorn_face: Magic! :company:"
// GChat: "🦄 Magic! 🏢"
```

## Rich Cards with Buttons

Send interactive cards with buttons that work across all platforms. Cards automatically convert to Block Kit (Slack), Adaptive Cards (Teams), and Google Chat Cards.

Configure your `tsconfig.json` to use the chat JSX runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "chat"
  }
}
```

Then use JSX syntax:

```tsx
import {
  Card,
  CardText,
  Button,
  LinkButton,
  Actions,
  Section,
  Fields,
  Field,
  Divider,
  Image,
  Modal,
  TextInput,
  Select,
  SelectOption,
} from "chat";

// Simple card with buttons
await thread.post(
  <Card title="Order #1234">
    <CardText>Your order has been received!</CardText>
    <Section>
      <CardText style="bold">Total: $50.00</CardText>
    </Section>
    <Actions>
      <Button id="approve" style="primary">
        Approve
      </Button>
      <Button id="reject" style="danger">
        Reject
      </Button>
      <LinkButton url="https://example.com/order/1234">View Order</LinkButton>
    </Actions>
  </Card>
);

// Card with fields (key-value pairs)
await thread.post(
  <Card title="User Profile">
    <Fields>
      <Field label="Name" value="John Doe" />
      <Field label="Role" value="Developer" />
      <Field label="Team" value="Platform" />
    </Fields>
    <Divider />
    <Actions>
      <Button id="edit">Edit Profile</Button>
    </Actions>
  </Card>
);

// Card with image
await thread.post(
  <Card title="Product Update">
    <Image url="https://example.com/product.png" alt="Product screenshot" />
    <CardText>Check out our new feature!</CardText>
  </Card>
);
```

**Note:** Use `CardText` (not `Text`) when using JSX to avoid conflicts with React's built-in types.

## Action Callbacks

Handle button clicks from cards:

```typescript
import { Chat, type ActionEvent } from "chat";

// Handle a specific action
bot.onAction("approve", async (event: ActionEvent) => {
  await event.thread.post(`Order approved by ${event.user.fullName}!`);
});

// Handle multiple actions
bot.onAction(["approve", "reject"], async (event: ActionEvent) => {
  const action = event.actionId === "approve" ? "approved" : "rejected";
  await event.thread.post(`Order ${action}!`);
});

// Catch-all action handler
bot.onAction(async (event: ActionEvent) => {
  console.log(`Action: ${event.actionId}, Value: ${event.value}`);
});
```

The `ActionEvent` includes `actionId`, `value`, `user`, `thread`, `messageId`, `threadId`, `adapter`, `triggerId`, and `raw` properties.

## Modals & Form Inputs

Open modal dialogs to collect structured user input. Modals support text inputs, dropdowns, and validation. Currently supported on Slack.

### Opening a Modal

Modals are opened in response to button clicks using `event.openModal()`. The SDK automatically tracks the thread and message context, making it available as `relatedThread` and `relatedMessage` in the submit/close handlers:

```tsx
import { Modal, TextInput, Select, SelectOption } from "chat";

// Handle a button click that opens a modal
bot.onAction("feedback", async (event) => {
  await event.openModal(
    <Modal
      callbackId="feedback_form"
      title="Send Feedback"
      submitLabel="Send"
      closeLabel="Cancel"
      notifyOnClose
    >
      <TextInput
        id="message"
        label="Your Feedback"
        placeholder="Tell us what you think..."
        multiline
      />
      <Select id="category" label="Category" placeholder="Select a category">
        <SelectOption label="Bug Report" value="bug" />
        <SelectOption label="Feature Request" value="feature" />
        <SelectOption label="General Feedback" value="general" />
      </Select>
      <TextInput
        id="email"
        label="Email (optional)"
        placeholder="your@email.com"
        optional
      />
    </Modal>
  );
});
```

### Modal Components

| Component      | Description                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `Modal`        | Container with `callbackId`, `title`, `submitLabel`, `closeLabel`, `notifyOnClose` |
| `TextInput`    | Text field with `id`, `label`, `placeholder`, `initialValue`, `multiline`, `optional`, `maxLength`    |
| `Select`       | Dropdown with `id`, `label`, `placeholder`, `initialOption`, `optional`                               |
| `SelectOption` | Option for Select with `label` and `value`                                                            |

### Handling Modal Submissions

Handle form submissions with `onModalSubmit`. The event includes `relatedThread` and `relatedMessage` which automatically reference the thread/message where the modal was triggered:

```typescript
import type { ModalSubmitEvent } from "chat";

bot.onModalSubmit("feedback_form", async (event: ModalSubmitEvent) => {
  const { message, category, email } = event.values;

  // Validate input - return errors to show in the modal
  if (!message || message.length < 5) {
    return {
      action: "errors",
      errors: { message: "Feedback must be at least 5 characters" },
    };
  }

  // Process the submission
  console.log("Received feedback:", { message, category, email });

  // Post confirmation to the original thread
  if (event.relatedThread) {
    await event.relatedThread.post(`Feedback received! Category: ${category}`);
  }
  // Optionally update the original message that triggered the modal
  if (event.relatedMessage) {
    await event.relatedMessage.edit("✅ Feedback submitted!");
  }

  // Return nothing to close the modal
});
```

### Modal Response Types

Return different responses from `onModalSubmit` to control modal behavior:

| Response                                                     | Description                                   |
| ------------------------------------------------------------ | --------------------------------------------- |
| `{ action: "close" }`                                        | Close the modal (default if nothing returned) |
| `{ action: "errors", errors: { fieldId: "Error message" } }` | Show validation errors on specific fields     |
| `{ action: "update", modal: ModalElement }`                  | Update the modal content                      |
| `{ action: "push", modal: ModalElement }`                    | Push a new modal view onto the stack          |

### Handling Modal Close

Optionally handle when users close/cancel a modal (requires `notifyOnClose` on the Modal):

```typescript
import type { ModalCloseEvent } from "chat";

bot.onModalClose("feedback_form", async (event: ModalCloseEvent) => {
  console.log(`${event.user.userName} cancelled the feedback form`);

  // Post a follow-up to the original thread
  if (event.relatedThread) {
    await event.relatedThread.post(
      "No worries, let us know if you change your mind!"
    );
  }
});
```

The `ModalSubmitEvent` includes `callbackId`, `viewId`, `values`, `user`, `adapter`, `relatedThread`, `relatedMessage`, and `raw` properties. The `ModalCloseEvent` includes the same properties except `values`.

## AI Integration & Streaming

Stream LLM responses directly to chat platforms. The SDK accepts any `AsyncIterable<string>` (like AI SDK's `textStream`), automatically using native streaming APIs where available (Slack) or falling back to post+edit for other platforms.

```typescript
import { Chat } from "chat";

// Stream AI response on @mention
bot.onNewMention(async (thread, message) => {
  const result = await agent.stream({ prompt: message.text });
  await thread.post(result.textStream);
});
```

### Platform Behavior

| Platform    | Streaming Method                    |
| ----------- | ----------------------------------- |
| Slack       | Native streaming API (`chatStream`) |
| Teams       | Post + edit with throttling         |
| Google Chat | Post + edit with throttling         |
| Discord     | Post + edit with throttling         |

The fallback method posts an initial message, then edits it as chunks arrive (throttled to avoid rate limits).

The SDK also supports **per-thread state** via `thread.setState()` and `thread.state` for tracking conversation modes, user preferences, or any thread-specific context.

## File Uploads

Send files along with messages:

```typescript
import type { Thread } from "chat";

// Send a file with a message
const reportBuffer = Buffer.from("PDF content");
await thread.post({
  markdown: "Here's the report you requested:",
  files: [
    {
      data: reportBuffer,
      filename: "report.pdf",
      mimeType: "application/pdf",
    },
  ],
});

// Send multiple files
const image1 = Buffer.from("image1");
const image2 = Buffer.from("image2");
await thread.post({
  markdown: "Attached are the images:",
  files: [
    { data: image1, filename: "screenshot1.png" },
    { data: image2, filename: "screenshot2.png" },
  ],
});

// Files only (with minimal text)
const buffer = Buffer.from("document content");
await thread.post({
  markdown: "",
  files: [{ data: buffer, filename: "document.xlsx" }],
});
```

### Reading Attachments

Access attachments from incoming messages:

```typescript
import { Chat } from "chat";

bot.onSubscribedMessage(async (thread, message) => {
  for (const attachment of message.attachments ?? []) {
    console.log(`File: ${attachment.name}, Type: ${attachment.mimeType}`);

    // Download the file data
    if (attachment.fetchData) {
      const data = await attachment.fetchData();
      // Process the file...
      console.log(`Downloaded ${data.length} bytes`);
    }
  }
});
```

The `Attachment` interface includes `type`, `url`, `name`, `mimeType`, `size`, `width`, `height`, and `fetchData` properties.

## Direct Messages

Initiate DM conversations programmatically. The adapter is automatically inferred from the userId format:

```typescript
import { Chat } from "chat";

// Open a DM using Author object (convenient in handlers)
bot.onSubscribedMessage(async (thread, message) => {
  if (message.text === "DM me") {
    const dmThread = await bot.openDM(message.author);
    await dmThread.post("Hello! This is a direct message.");
  }
});

// Or use userId string directly - adapter inferred from format:
// - Slack: U... (e.g., "U1234567890")
// - Teams: 29:... (e.g., "29:abc123...")
// - Google Chat: users/... (e.g., "users/123456789")
const dmThread = await bot.openDM("U1234567890");

// Check if a thread is a DM
bot.onSubscribedMessage(async (thread, message) => {
  if (thread.isDM) {
    await thread.post("This is a private conversation.");
  }
});
```

## Ephemeral Messages

Send a message visible only to a specific user:

```typescript
await thread.postEphemeral(user, "Only you can see this!", {
  fallbackToDM: true,
});
```

The `fallbackToDM` option is required and controls behavior on platforms without native ephemeral support:

- `fallbackToDM: true` - Send as DM if native ephemeral isn't supported
- `fallbackToDM: false` - Return `null` if native ephemeral isn't supported

### Platform Behavior

| Platform    | Native Support | Behavior             | Where it appears                            | Persistence                              |
| ----------- | -------------- | -------------------- | ------------------------------------------- | ---------------------------------------- |
| Slack       | Yes            | Ephemeral in channel | In the channel, only visible to target user | Session-only (disappears on page reload) |
| Google Chat | Yes            | Private message      | In the space, only visible to target user   | Persists until deleted                   |
| Discord     | No             | DM (if enabled)      | In a DM conversation with the bot           | Persists in DM                           |
| Teams       | No             | DM (if enabled)      | In a DM conversation with the bot           | Persists in DM                           |

**Key differences:**

- **Slack**: True ephemeral - message appears in the channel context but disappears when the user refreshes. Other users never see it. **Note:** Requires additional OAuth scopes beyond `chat:write` - add `channels:write` (public), `groups:write` (private), `im:write` (DMs), or `mpim:write` (group DMs) depending on your use case.
- **Google Chat**: Private message viewer - message appears in the space but only the target user can see it. It persists and can be deleted by the bot.
- **Discord/Teams**: No native ephemeral support. With `fallbackToDM: true`, sends a DM instead. With `fallbackToDM: false`, returns `null`.

### Examples

**Always deliver the message (DM fallback):**

```typescript
const result = await thread.postEphemeral(user, "Private notification", {
  fallbackToDM: true,
});

if (result?.usedFallback) {
  // Was sent as DM on Discord/Teams
  console.log(`Sent as DM: ${result.threadId}`);
}
```

**Only send if native ephemeral is supported:**

```typescript
const result = await thread.postEphemeral(user, "Contextual hint", {
  fallbackToDM: false,
});

if (!result) {
  // Platform doesn't support native ephemeral (Discord/Teams)
  // Message was not sent - handle accordingly or skip
}
```

## Development

```bash
pnpm install
pnpm build
pnpm dev         # Run example app
pnpm typecheck
pnpm lint
```

## License

MIT
---

# Chat SDK Setup Guide

This guide covers environment setup for the Chat SDK. For platform-specific setup instructions, see the individual adapter documentation.

## Environment Variables

Create a `.env.local` file in `examples/nextjs-chat/` with the following variables:

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# Microsoft Teams
TEAMS_APP_ID=...
TEAMS_APP_PASSWORD=...
TEAMS_APP_TENANT_ID=...

# Google Chat
GOOGLE_CHAT_CREDENTIALS={"type":"service_account",...}
GOOGLE_CHAT_PUBSUB_TOPIC=projects/your-project/topics/chat-events  # Optional
GOOGLE_CHAT_IMPERSONATE_USER=admin@yourdomain.com  # Optional

# Discord
DISCORD_BOT_TOKEN=...
DISCORD_PUBLIC_KEY=...
DISCORD_APPLICATION_ID=...
DISCORD_MENTION_ROLE_IDS=...  # Optional: comma-separated role IDs
CRON_SECRET=...  # Required for Gateway cron in serverless

# Redis (required for serverless deployments)
REDIS_URL=redis://localhost:6379
```

## Platform Setup

Each adapter has its own README with detailed setup instructions:

| Platform | Adapter Package | Setup Guide |
|----------|-----------------|-------------|
| Slack | `@chat-adapter/slack` | [README](./packages/adapter-slack/README.md) |
| Microsoft Teams | `@chat-adapter/teams` | [README](./packages/adapter-teams/README.md) |
| Google Chat | `@chat-adapter/gchat` | [README](./packages/adapter-gchat/README.md) |
| Discord | `@chat-adapter/discord` | [README](./packages/adapter-discord/README.md) |

## Vercel Deployment

### Configure Environment Variables

1. Go to **Settings** → **Environment Variables** in your Vercel project
2. Add all variables from the `.env.local` section above
3. Select appropriate environments (Production, Preview, Development)

### Set Root Directory

If deploying from the monorepo root:

1. Go to **Settings** → **General**
2. Set **Root Directory** to `examples/nextjs-chat`

## Testing Your Setup

### Slack
```
@YourBot hello
```

### Teams
Chat directly with the bot or @mention in a channel.

### Google Chat
```
@YourBot hello
```

### Discord
```
@YourBot hello
```

The bot will respond and may create a thread for the conversation.

## Troubleshooting

### Redis connection errors
- Verify `REDIS_URL` is correct
- For Vercel, use Upstash Redis or similar serverless-compatible Redis
- Check firewall/network rules allow connections

### Duplicate messages
The SDK includes deduplication, but ensure Redis is properly configured for production deployments.

For platform-specific troubleshooting, see the individual adapter READMEs linked above.

---

# @chat-adapter/slack

Slack adapter for the [chat](https://github.com/vercel-labs/chat) SDK.

## Installation

```bash
npm install chat @chat-adapter/slack
```

## Usage

```typescript
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";

const chat = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    }),
  },
});

// Handle @mentions
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from Slack!");
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` | Yes | Slack bot token (starts with `xoxb-`) |
| `signingSecret` | Yes | Slack signing secret for webhook verification |

## Environment Variables

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

## Slack App Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Enter app name and select workspace
4. Click **Create App**

### 2. Configure Bot Token Scopes

1. Go to **OAuth & Permissions** in the sidebar
2. Under **Scopes** → **Bot Token Scopes**, add:
   - `app_mentions:read` - Receive @mention events
   - `channels:history` - Read messages in public channels
   - `channels:read` - View basic channel info
   - `chat:write` - Send messages
   - `groups:history` - Read messages in private channels
   - `groups:read` - View basic private channel info
   - `im:history` - Read direct messages
   - `im:read` - View basic DM info
   - `reactions:read` - View emoji reactions
   - `reactions:write` - Add/remove emoji reactions
   - `users:read` - View user info (for display names)

### 3. Install App to Workspace

1. Go to **OAuth & Permissions**
2. Click **Install to Workspace**
3. Authorize the app
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`) → `SLACK_BOT_TOKEN`

### 4. Get Signing Secret

1. Go to **Basic Information**
2. Under **App Credentials**, copy **Signing Secret** → `SLACK_SIGNING_SECRET`

### 5. Configure Event Subscriptions

1. Go to **Event Subscriptions**
2. Toggle **Enable Events** to On
3. Set **Request URL** to: `https://your-domain.com/api/webhooks/slack`
   - Slack will verify the URL immediately
4. Under **Subscribe to bot events**, add:
   - `app_mention` - When someone @mentions your bot
   - `message.channels` - Messages in public channels
   - `message.groups` - Messages in private channels
   - `message.im` - Direct messages
5. Click **Save Changes**

### 6. (Optional) Enable Interactivity

If you want to use buttons, modals, or other interactive components:

1. Go to **Interactivity & Shortcuts**
2. Toggle **Interactivity** to On
3. Set **Request URL** to: `https://your-domain.com/api/webhooks/slack`

## Features

- Message posting and editing
- Thread subscriptions
- Reaction handling (add/remove/events)
- File attachments
- Rich cards (Block Kit)
- Action callbacks (interactive components)
- Direct messages

## Troubleshooting

### "Invalid signature" error
- Verify `SLACK_SIGNING_SECRET` is correct
- Check that the request timestamp is within 5 minutes (clock sync issue)

### Bot not responding to messages
- Verify Event Subscriptions are configured
- Check that the bot has been added to the channel
- Ensure the webhook URL is correct and accessible

## License

MIT

---

# @chat-adapter/discord

Discord adapter for the [chat](https://github.com/vercel-labs/chat) SDK.

## Installation

```bash
npm install chat @chat-adapter/discord
```

## Usage

```typescript
import { Chat } from "chat";
import { createDiscordAdapter } from "@chat-adapter/discord";

const chat = new Chat({
  userName: "mybot",
  adapters: {
    discord: createDiscordAdapter({
      botToken: process.env.DISCORD_BOT_TOKEN!,
      publicKey: process.env.DISCORD_PUBLIC_KEY!,
      applicationId: process.env.DISCORD_APPLICATION_ID!,
      // Optional: trigger on role mentions too
      mentionRoleIds: process.env.DISCORD_MENTION_ROLE_IDS?.split(","),
    }),
  },
});

// Handle @mentions
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from Discord!");
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` | Yes | Discord bot token |
| `publicKey` | Yes | Discord application public key (for webhook signature verification) |
| `applicationId` | Yes | Discord application ID |
| `mentionRoleIds` | No | Array of role IDs that should trigger mention handlers |

## Discord Application Setup

### 1. Create Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and give it a name
3. Note the **Application ID** from the General Information page
4. Copy the **Public Key** from the General Information page

### 2. Create Bot

1. Go to the **Bot** section in the left sidebar
2. Click **Reset Token** to generate a new bot token
3. Copy and save the token (you won't see it again)
4. Enable these **Privileged Gateway Intents**:
   - Message Content Intent
   - Server Members Intent (if needed)

### 3. Configure Interactions Endpoint

1. Go to **General Information**
2. Set **Interactions Endpoint URL** to: `https://your-domain.com/api/webhooks/discord`
3. Discord will send a PING request to verify the endpoint

### 4. Add Bot to Server

1. Go to **OAuth2 > URL Generator**
2. Select scopes: `bot`, `applications.commands`
3. Select bot permissions:
   - Send Messages
   - Send Messages in Threads
   - Create Public Threads
   - Read Message History
   - Add Reactions
   - Attach Files
4. Copy the generated URL and open it to add the bot to your server

## Environment Variables

```bash
# Required
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_PUBLIC_KEY=your-application-public-key
DISCORD_APPLICATION_ID=your-application-id

# Optional: trigger on role mentions (comma-separated)
DISCORD_MENTION_ROLE_IDS=1234567890,0987654321

# For Gateway mode with Vercel Cron
CRON_SECRET=your-random-secret
```

## Architecture: HTTP Interactions vs Gateway

Discord has two ways to receive events:

### HTTP Interactions (Default)
- Receives button clicks, slash commands, and verification pings
- Works out of the box with serverless
- **Does NOT receive regular messages** - only interactions

### Gateway WebSocket (Required for Messages)
- Required to receive regular messages and reactions
- Requires a persistent connection
- In serverless environments, use a cron job to maintain the connection

## Gateway Setup for Serverless

For Vercel/serverless deployments, set up a cron job to maintain the Gateway connection:

### 1. Create Gateway Route

```typescript
// app/api/discord/gateway/route.ts
import { NextResponse } from "next/server";
import { after } from "next/server";
import { discord } from "@/lib/bot";

export const maxDuration = 800; // Maximum Vercel function duration

export async function GET(request: Request): Promise<Response> {
  // Validate cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Start Gateway listener (runs for 10 minutes)
  const durationMs = 600 * 1000;
  const webhookUrl = `https://${process.env.VERCEL_URL}/api/webhooks/discord`;

  return discord.startGatewayListener(
    { waitUntil: (task) => after(() => task) },
    durationMs,
    undefined,
    webhookUrl
  );
}
```

### 2. Configure Vercel Cron

Create `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/discord/gateway",
      "schedule": "*/9 * * * *"
    }
  ]
}
```

This runs every 9 minutes, ensuring overlap with the 10-minute listener duration.

### 3. Add Environment Variables

Add `CRON_SECRET` to your Vercel project settings.

## Role Mentions

By default, only direct user mentions (`@BotName`) trigger `onNewMention` handlers. To also trigger on role mentions (e.g., `@AI`):

1. Create a role in your Discord server (e.g., "AI")
2. Assign the role to your bot
3. Copy the role ID (right-click role in server settings with Developer Mode enabled)
4. Add the role ID to `DISCORD_MENTION_ROLE_IDS`

```typescript
createDiscordAdapter({
  botToken: process.env.DISCORD_BOT_TOKEN!,
  publicKey: process.env.DISCORD_PUBLIC_KEY!,
  applicationId: process.env.DISCORD_APPLICATION_ID!,
  mentionRoleIds: ["1457473602180878604"], // Your role ID
});
```

## Features

- Message posting and editing
- Thread creation and management
- Reaction handling (add/remove/events)
- File attachments
- Rich embeds (cards with buttons)
- Action callbacks (button interactions)
- Direct messages
- Role mention support

## Testing

Run a local tunnel (e.g., ngrok) to test webhooks:

```bash
ngrok http 3000
```

Update the Interactions Endpoint URL in the Discord Developer Portal to your ngrok URL.

## Troubleshooting

### Bot not responding to messages

1. **Check Gateway connection**: Messages require the Gateway WebSocket, not just HTTP interactions
2. **Verify Message Content Intent**: Enable this in the Bot settings
3. **Check bot permissions**: Ensure the bot can read messages in the channel

### Role mentions not triggering

1. **Verify role ID**: Enable Developer Mode in Discord settings, then right-click the role
2. **Check mentionRoleIds config**: Ensure the role ID is in the array
3. **Confirm bot has the role**: The bot must have the role assigned to be mentioned via that role

### Signature verification failing

1. **Check public key format**: Should be a 64-character hex string (lowercase)
2. **Verify endpoint URL**: Must exactly match what's configured in Discord Developer Portal
3. **Check for body parsing**: Don't parse the request body before verification

## License

MIT
