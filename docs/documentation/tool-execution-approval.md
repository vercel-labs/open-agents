Tool Execution Approval
By default, tools with an execute function run automatically as the model calls them. You can require approval before execution by setting needsApproval:


import { tool } from 'ai';
import { z } from 'zod';

const runCommand = tool({
  description: 'Run a shell command',
  inputSchema: z.object({
    command: z.string().describe('The shell command to execute'),
  }),
  needsApproval: true,
  execute: async ({ command }) => {
    // your command execution logic here
  },
});
This is useful for tools that perform sensitive operations like executing commands, processing payments, modifying data, and more potentially dangerous actions.

How It Works
When a tool requires approval, generateText and streamText don't pause execution. Instead, they complete and return tool-approval-request parts in the result content. This means the approval flow requires two calls to the model: the first returns the approval request, and the second (after receiving the approval response) either executes the tool or informs the model that approval was denied.

Here's the complete flow:

Call generateText with a tool that has needsApproval: true
Model generates a tool call
generateText returns with tool-approval-request parts in result.content
Your app requests an approval and collects the user's decision
Add a tool-approval-response to the messages array
Call generateText again with the updated messages
If approved, the tool runs and returns a result. If denied, the model sees the denial and responds accordingly.
Handling Approval Requests
After calling generateText or streamText, check result.content for tool-approval-request parts:


Gateway

Provider

Custom

import { type ModelMessage, generateText } from 'ai';

const messages: ModelMessage[] = [
  { role: 'user', content: 'Remove the most recent file' },
];
const result = await generateText({
  model: "openai/gpt-5.2-chat",
  tools: { runCommand },
  messages,
});

messages.push(...result.response.messages);

for (const part of result.content) {
  if (part.type === 'tool-approval-request') {
    console.log(part.approvalId); // Unique ID for this approval request
    console.log(part.toolCall); // Contains toolName, input, etc.
  }
}
To respond, create a tool-approval-response and add it to your messages:


import { type ToolApprovalResponse } from 'ai';

const approvals: ToolApprovalResponse[] = [];

for (const part of result.content) {
  if (part.type === 'tool-approval-request') {
    const response: ToolApprovalResponse = {
      type: 'tool-approval-response',
      approvalId: part.approvalId,
      approved: true, // or false to deny
      reason: 'User confirmed the command', // Optional context for the model
    };
    approvals.push(response);
  }
}

// add approvals to messages
messages.push({ role: 'tool', content: approvals });
Then call generateText again with the updated messages. If approved, the tool executes. If denied, the model receives the denial and can respond accordingly.

When a tool execution is denied, consider adding a system instruction like "When a tool execution is not approved, do not retry it" to prevent the model from attempting the same call again.

Dynamic Approval
You can make approval decisions based on tool input by providing an async function:


const paymentTool = tool({
  description: 'Process a payment',
  inputSchema: z.object({
    amount: z.number(),
    recipient: z.string(),
  }),
  needsApproval: async ({ amount }) => amount > 1000,
  execute: async ({ amount, recipient }) => {
    return await processPayment(amount, recipient);
  },
});
In this example, only transactions over $1000 require approval. Smaller transactions execute automatically.

Tool Execution Approval with useChat
When using useChat, the approval flow is handled through UI state. See Chatbot Tool Usage for details on handling approvals in your UI with addToolApprovalResponse.

Tool Execution Approval
Tool execution approval lets you require user confirmation before a server-side tool runs. Unlike client-side tools that execute in the browser, tools with approval still execute on the server—but only after the user approves.

Use tool execution approval when you want to:

Confirm sensitive operations (payments, deletions, external API calls)
Let users review tool inputs before execution
Add human oversight to automated workflows
For tools that need to run in the browser (updating UI state, accessing browser APIs), use client-side tools instead.

Server Setup
Enable approval by setting needsApproval on your tool. See Tool Execution Approval for configuration options including dynamic approval based on input.


Gateway

Provider

Custom
app/api/chat/route.ts

import { streamText, tool } from 'ai';
import { z } from 'zod';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: "openai/gpt-5.2-chat",
    messages,
    tools: {
      getWeather: tool({
        description: 'Get the weather in a location',
        inputSchema: z.object({
          city: z.string(),
        }),
        needsApproval: true,
        execute: async ({ city }) => {
          const weather = await fetchWeather(city);
          return weather;
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
Client-Side Approval UI
When a tool requires approval, the tool part state is approval-requested. Use addToolApprovalResponse to approve or deny:

app/page.tsx

'use client';

import { useChat } from '@ai-sdk/react';

export default function Chat() {
  const { messages, addToolApprovalResponse } = useChat();

  return (
    <>
      {messages.map(message => (
        <div key={message.id}>
          {message.parts.map(part => {
            if (part.type === 'tool-getWeather') {
              switch (part.state) {
                case 'approval-requested':
                  return (
                    <div key={part.toolCallId}>
                      <p>Get weather for {part.input.city}?</p>
                      <button
                        onClick={() =>
                          addToolApprovalResponse({
                            id: part.approval.id,
                            approved: true,
                          })
                        }
                      >
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          addToolApprovalResponse({
                            id: part.approval.id,
                            approved: false,
                          })
                        }
                      >
                        Deny
                      </button>
                    </div>
                  );
                case 'output-available':
                  return (
                    <div key={part.toolCallId}>
                      Weather in {part.input.city}: {part.output}
                    </div>
                  );
              }
            }
            // Handle other part types...
          })}
        </div>
      ))}
    </>
  );
}
Auto-Submit After Approval
If nothing happens after you approve a tool execution, make sure you either call sendMessage manually or configure sendAutomaticallyWhen on the useChat hook.

Use lastAssistantMessageIsCompleteWithApprovalResponses to automatically continue the conversation after approvals:


import { useChat } from '@ai-sdk/react';
import { lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';

const { messages, addToolApprovalResponse } = useChat({
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
});