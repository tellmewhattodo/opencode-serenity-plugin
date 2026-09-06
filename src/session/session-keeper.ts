/**
 * session-keeper.ts — trajectory-assistant (v0.9): SESSION.md 记录督促机制
 *
 * Tracks READ/WRITE tool activity with weighted scoring.
 * When score reaches threshold, injects a reminder into the user message
 * requiring the model to ACK with a random 3-char code.
 * Reminder persists every round until ACK received.
 *
 * v0.9 改名对齐（specs v1.4.0 §5.11 + dsp v1.30）：[Session-Keeper] → [TRAJECTORY-ASSISTANT · CHECKPOINT]
 * 阈值默认 150 → 100（spec 默认）；预声明文本进 Session 块（compacting.ts 注入）。
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ──

interface KeeperState {
  score: number;
  threshold: number;
  pendingCode: string | null;
  lastAckType: "recorded" | "skipped" | null;
  lastResetAt: number;
  lastElapsedContribution: number;
}

type SessionId = string;

// ── Constants ──

const DEFAULT_THRESHOLD = 100; // v0.9: 150 → 100 (specs v1.4.0 默认)
const WRITE_WEIGHT = 3;
const READ_WEIGHT = 1;
const DELEGATE_WEIGHT = 10;

const READ_TOOLS = new Set([
  "read", "grep", "glob", "msm", "msm_list", "container_admin", "ccc_admin", "msm_exec", "logbook",
]);

const WRITE_TOOLS = new Set([
  "write", "edit",
]);

const DELEGATE_TOOLS = new Set([
  "task",
]);

// container_fs subcommands: write operations
const WRITE_FS_SUBCOMMANDS = new Set([
  "mkdir", "rm", "mv", "cp", "touch", "append",
]);

// container_git subcommands: write operations
const WRITE_GIT_SUBCOMMANDS = new Set(["commit", "push"]);

const ACK_PATTERN = /\[TRAJECTORY-ASSISTANT-(recorded|skipped)-([A-Za-z0-9]{3})\]/;

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const REMINDER_TEXT =
  "\n\n" +
  "\u2501".repeat(80) + "\n" +
  "[TRAJECTORY-ASSISTANT · CHECKPOINT] Score threshold reached. Active session: S###.\n" +
  "\n" +
  "DO NOT ignore this message. Append the ACK code below to your response.\n" +
  "DO NOT stop ongoing work — continue your task while acknowledging.\n" +
  "\n" +
  "If session progress should be recorded:\n" +
  "  [TRAJECTORY-ASSISTANT-recorded-{code}]\n" +
  "If nothing to record this round:\n" +
  "  [TRAJECTORY-ASSISTANT-skipped-{code}]\n" +
  "\n" +
  "Use the exact code above. Codes are single-use; do not reuse from prior rounds.\n" +
  "\u2501".repeat(80);

// ── State ──

const store = new Map<SessionId, KeeperState>();

/** Reset all state (test cleanup) */
export function resetKeeperStore(): void {
  store.clear();
}

function getOrCreate(id: SessionId, threshold: number, messages?: any[]): KeeperState {
  let s = store.get(id);
  if (!s) {
    if (messages) {
      // Rebuild state from message history (session restore path)
      const rebuilt = rebuildFromHistory(messages, threshold);
      if (rebuilt) {
        store.set(id, rebuilt);
        return rebuilt;
      }
    }
    s = { score: 0, threshold, pendingCode: null, lastAckType: null, lastResetAt: Date.now(), lastElapsedContribution: 0 };
    store.set(id, s);
  }
  return s;
}

/** Rebuild keeper state from message history (after session restore/reconnect).
 *  Fresh start: score=0, only find last reset point (session use/ACK) for state tracking.
 *  Incremental tool counting via addToolWeight takes over from here. */
function rebuildFromHistory(messages: any[], threshold: number): KeeperState | null {
  let lastAckType: "recorded" | "skipped" | null = null;

  // Scan in reverse: most recent session use / ACK wins
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const msg = messages[mi];
    if (!msg) continue;

    for (const part of msg.parts ?? []) {
      if (isToolCallPart(part)) {
        const name = toolNameFromPart(part);
        const input = toolInputFromPart(part);
        if (name === "session" && input.subcommand === "use") {
          lastAckType = null;
        }
      }
      if (isToolResultPart(part)) {
        if (toolOutputText(part).includes("[SESSION CONTEXT] Activated:")) {
          lastAckType = null;
        }
      }
      if ((part.type === "text" || part.type === "reasoning") && msg.info?.role === "assistant") {
        const match = (part.text ?? "").match(ACK_PATTERN);
        if (match) {
          lastAckType = match[1] as "recorded" | "skipped";
        }
      }
    }
  }

  return {
    score: 0,
    threshold,
    pendingCode: null,
    lastAckType,
    lastResetAt: Date.now(),
    lastElapsedContribution: 0,
  };
}

// ── Config ──

export function readKeeperThreshold(cwdRoot: string): number {
  try {
    const configPath = join(cwdRoot, ".opencode", "serenity.json");
    if (!existsSync(configPath)) return DEFAULT_THRESHOLD;
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const t = parsed?.sessionKeeper?.threshold;
    return typeof t === "number" ? t : DEFAULT_THRESHOLD;
  } catch {
    return DEFAULT_THRESHOLD;
  }
}

// ── Helpers ──

function randomCode(): string {
  let code = "";
  for (let i = 0; i < 3; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function injectReminderMsg(text: string, code: string, sessionId: string): string {
  return text + REMINDER_TEXT.replace(/\{code\}/g, code).replace(/S###/, sessionId);
}

/** Extract tool name from a part (SDK ToolPart.tool field) */
function toolNameFromPart(part: any): string {
  return part.tool ?? "";
}

/** Check if a part is a tool call (SDK ToolPart, type === "tool") */
function isToolCallPart(part: any): boolean {
  return part.type === "tool";
}

/** Extract tool input from a part (legacy .input field for tests) */
function toolInputFromPart(part: any): Record<string, unknown> {
  return part.input ?? {};
}

/** Check if a part is a completed tool result */
function isToolResultPart(part: any): boolean {
  return part.type === "tool" && part.state?.status === "completed";
}

/** Get output text from a completed tool part */
function toolOutputText(part: any): string {
  return typeof (part.state as any)?.output === "string" ? (part.state as any).output : "";
}

function findLastAssistantText(messages: any[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.info?.role !== "assistant") continue;
    for (const part of msg.parts ?? []) {
      if (part.type === "text" || part.type === "reasoning") {
        const t = part.text ?? "";
        if (t.trim()) return t;
      }
    }
    break;
  }
  return null;
}

/** Increment keeper score for a tool execution. Called from tool.execute.before hook. */
export function addToolWeight(sessionId: string, toolName: string, args: Record<string, unknown>): void {
  let state = store.get(sessionId);
  if (!state) {
    state = { score: 0, threshold: DEFAULT_THRESHOLD, pendingCode: null, lastAckType: null, lastResetAt: Date.now(), lastElapsedContribution: 0 };
    store.set(sessionId, state);
  }
  if (state.pendingCode) return;

  let weight = 0;
  if (DELEGATE_TOOLS.has(toolName)) {
    weight = DELEGATE_WEIGHT;
  } else if (WRITE_TOOLS.has(toolName)) {
    weight = WRITE_WEIGHT;
  } else if (toolName === "container_fs") {
    const sub = String(args.subcommand ?? "");
    weight = WRITE_FS_SUBCOMMANDS.has(sub) ? WRITE_WEIGHT : READ_WEIGHT;
  } else if (toolName === "container_git") {
    const sub = String(args.subcommand ?? "");
    weight = WRITE_GIT_SUBCOMMANDS.has(sub) ? WRITE_WEIGHT : READ_WEIGHT;
  } else if (READ_TOOLS.has(toolName)) {
    weight = READ_WEIGHT;
  }

  if (weight > 0) {
    state.score += weight;
  }
}

/** Check if score reached threshold and return reminder text for tool output injection.
 *  Called from tool.execute.after hook for immediate feedback (DCP pattern). */
export function triggerOnToolResult(sessionId: string, toolOutput: string, sessionDirName: string): string | null {
  const state = store.get(sessionId);
  if (!state || state.pendingCode) return null;
  if (state.score < state.threshold) return null;

  const code = randomCode();
  state.pendingCode = code;
  const reminder = injectReminderMsg("", code, sessionDirName).trimStart();
  return toolOutput + "\n\n" + reminder;
}

function detectAck(assistantText: string | null, expectedCode: string): "recorded" | "skipped" | "invalid" | null {
  if (!assistantText) return null;
  const match = assistantText.match(ACK_PATTERN);
  if (!match) return null;
  if (match[2] !== expectedCode) return "invalid";
  return match[1] as "recorded" | "skipped";
}

// ── Main entry: called from messages.transform hook ──

export interface KeeperResult {
  reminder: string | null;
  code: string | null;
}

export function processSessionKeeper(
  ocSessionId: string,
  messages: any[],
  cwdRoot: string,
  sessionDirName: string,
): KeeperResult {
  const threshold = readKeeperThreshold(cwdRoot);
  const state = getOrCreate(ocSessionId, threshold, messages);
  state.threshold = threshold;

  // Step 1: check for ACK in last assistant response
  if (state.pendingCode) {
    const lastText = findLastAssistantText(messages);
    const ack = detectAck(lastText, state.pendingCode);
    if (ack === "recorded" || ack === "skipped") {
      state.score = 0;
      state.pendingCode = null;
      state.lastResetAt = Date.now();
      state.lastElapsedContribution = 0;
      state.lastAckType = ack;
    }
  }

  // Step 2: add elapsed time since last reset (incremental delta)
  if (!state.pendingCode) {
    const elapsedSinceReset = Math.floor((Date.now() - state.lastResetAt) / 60000);
    const delta = elapsedSinceReset - state.lastElapsedContribution;
    if (delta > 0) {
      state.score += delta;
      state.lastElapsedContribution = elapsedSinceReset;
    }
  }

  // Step 3: inject reminder if needed
  if (state.pendingCode) {
    const reminder = injectReminderMsg("", state.pendingCode, sessionDirName).trimStart();
    return { reminder, code: state.pendingCode };
  }

  if (state.score >= state.threshold) {
    const code = randomCode();
    state.pendingCode = code;
    const reminder = injectReminderMsg("", code, sessionDirName).trimStart();
    return { reminder, code };
  }

  return { reminder: null, code: null };
}
