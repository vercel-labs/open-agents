#!/usr/bin/env bash
#
# End-to-end smoke test for the agent stack, driven by curl.
#
# What it does (new chat):
#   1. Mints a session cookie for the test bot via POST /api/dev/session
#   2. Creates a chat session via POST /api/sessions
#   3. Waits for the Vercel sandbox to become active
#   4. Sends a message via POST /api/chat and streams the response
#
# What it does (follow-up to existing chat, --session SESSION_ID):
#   1. Mints a fresh cookie
#   2. Fetches the chat and its message history
#   3. Appends the new user message and streams the response
#
# Requirements:
#   - dev server running on $BASE (default http://localhost:3000)
#   - OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION=true set in the dev server's environment
#   - OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION set in apps/web/.env.local (or exported in the shell)
#   - VERCEL_OIDC_TOKEN valid in the dev server's environment
#   - jq installed
#
# Usage:
#   bash scripts/test-agent.sh                                # new chat, default prompt
#   bash scripts/test-agent.sh "Your custom prompt"           # new chat, custom prompt
#   bash scripts/test-agent.sh --session SESSION_ID "Prompt"  # follow-up to existing chat
#   BASE=http://localhost:3001 bash scripts/test-agent.sh
#
# See docs/agents/endpoints.md for the full curl-based testing guide.

set -euo pipefail

BASE="${BASE:-http://localhost:3000}"

EXISTING_SESSION_ID=""
EXISTING_CHAT_ID=""
PROMPT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --session)
      EXISTING_SESSION_ID="$2"
      shift 2
      ;;
    --chat)
      EXISTING_CHAT_ID="$2"
      shift 2
      ;;
    --help|-h)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      if [ -z "$PROMPT" ]; then
        PROMPT="$1"
      else
        echo "Unexpected extra argument: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

PROMPT="${PROMPT:-Reply with just the digits: 42}"

# Resolve dev-only test auth vars: prefer exported env, fall back to .env.local.
if [ -z "${OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION:-}" ]; then
  if [ -f apps/web/.env.local ]; then
    OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION=$(grep -E '^OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION=' apps/web/.env.local | head -1 | sed -E 's/^OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION=//')
  fi
fi

if [ -z "${OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION:-}" ]; then
  if [ -f apps/web/.env.local ]; then
    OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION=$(grep -E '^OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION=' apps/web/.env.local | head -1 | sed -E 's/^OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION=//')
  fi
fi

if [ "${OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION:-}" != "true" ]; then
  echo "OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION must be set to true in the dev server environment." >&2
  exit 1
fi

if [ -z "${OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION:-}" ]; then
  echo "OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION is not set. Export it or add it to apps/web/.env.local." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (brew install jq)." >&2
  exit 1
fi

echo "1. Minting bot session cookie..."
MINT=$(curl -s -X POST "$BASE/api/dev/session" -H "X-Test-Auth: $OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION")
COOKIE=$(echo "$MINT" | jq -r .header)
USER_ID=$(echo "$MINT" | jq -r .user.id)
if [ -z "$COOKIE" ] || [ "$COOKIE" = "null" ]; then
  echo "Failed to mint session. Response:" >&2
  echo "$MINT" >&2
  exit 1
fi
echo "   bot user: $USER_ID"

PRIOR_MESSAGES="[]"

if [ -n "$EXISTING_SESSION_ID" ]; then
  echo
  echo "2. Resolving chat for session $EXISTING_SESSION_ID..."
  if [ -n "$EXISTING_CHAT_ID" ]; then
    CHAT_ID="$EXISTING_CHAT_ID"
  else
    CHATS=$(curl -s "$BASE/api/sessions/$EXISTING_SESSION_ID/chats" -H "Cookie: $COOKIE")
    CHAT_ID=$(echo "$CHATS" | jq -r '.chats[0].id // empty')
    if [ -z "$CHAT_ID" ]; then
      echo "No chats found for session $EXISTING_SESSION_ID. Response:" >&2
      echo "$CHATS" >&2
      exit 1
    fi
  fi
  SESSION_ID="$EXISTING_SESSION_ID"
  echo "   sessionId: $SESSION_ID"
  echo "   chatId:    $CHAT_ID"

  echo
  echo "3. Fetching prior message history..."
  CHAT_DATA=$(curl -s "$BASE/api/sessions/$SESSION_ID/chats/$CHAT_ID" -H "Cookie: $COOKIE")
  PRIOR_MESSAGES=$(echo "$CHAT_DATA" | jq '.messages')
  if [ "$PRIOR_MESSAGES" = "null" ] || [ -z "$PRIOR_MESSAGES" ]; then
    echo "Failed to load prior messages. Response:" >&2
    echo "$CHAT_DATA" >&2
    exit 1
  fi
  MSG_COUNT=$(echo "$PRIOR_MESSAGES" | jq 'length')
  echo "   loaded $MSG_COUNT prior message(s)"
else
  echo
  echo "2. Creating a chat session (kicks off Vercel sandbox provisioning)..."
  CREATE=$(curl -s -X POST "$BASE/api/sessions" \
    -H "Cookie: $COOKIE" \
    -H "content-type: application/json" \
    -d '{}')
  SESSION_ID=$(echo "$CREATE" | jq -r .session.id)
  CHAT_ID=$(echo "$CREATE" | jq -r .chat.id)
  MODEL=$(echo "$CREATE" | jq -r .chat.modelId)
  if [ "$SESSION_ID" = "null" ] || [ -z "$SESSION_ID" ]; then
    echo "Failed to create session. Response:" >&2
    echo "$CREATE" >&2
    exit 1
  fi
  echo "   sessionId: $SESSION_ID"
  echo "   chatId:    $CHAT_ID"
  echo "   model:     $MODEL"

  echo
  echo "3. Waiting for sandbox to become active..."
  for i in $(seq 1 30); do
    STATUS=$(curl -s "$BASE/api/sandbox/status?sessionId=$SESSION_ID" -H "Cookie: $COOKIE")
    STATE=$(echo "$STATUS" | jq -r '.lifecycle.state')
    printf "   [%2d] %s\n" "$i" "$STATE"
    if [ "$STATE" = "active" ]; then
      break
    fi
    if [ "$STATE" = "failed" ]; then
      echo "   sandbox provisioning failed — check VERCEL_OIDC_TOKEN in the dev server env." >&2
      echo "   full status:" >&2
      echo "$STATUS" | jq . >&2
      exit 1
    fi
    sleep 4
  done

  if [ "$STATE" != "active" ]; then
    echo "   gave up waiting after ~2 minutes." >&2
    exit 1
  fi
fi

echo
echo "4. Sending message: \"$PROMPT\""
echo "   (streaming response below — text-delta chunks form the agent reply)"
echo "----------------------------------------"
PAYLOAD=$(jq -n \
  --arg s "$SESSION_ID" \
  --arg c "$CHAT_ID" \
  --arg id "msg_$(date +%s)" \
  --arg text "$PROMPT" \
  --argjson prior "$PRIOR_MESSAGES" \
  '{
    sessionId: $s,
    chatId: $c,
    messages: ($prior + [{
      id: $id,
      role: "user",
      parts: [{ type: "text", text: $text }]
    }])
  }')

curl -sN -X POST "$BASE/api/chat" \
  -H "Cookie: $COOKIE" \
  -H "content-type: application/json" \
  -d "$PAYLOAD"

echo
echo "----------------------------------------"
echo
echo "To send a follow-up to this chat:"
echo "  bash scripts/test-agent.sh --session $SESSION_ID \"Your next prompt\""
