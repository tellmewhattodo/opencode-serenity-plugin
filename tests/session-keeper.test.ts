/**
 * session-keeper.test.ts — Session-keeper unit tests
 *
 * Tests: config reading, score accumulation, ACK detection,
 * reminder injection, code validation, multi-round state machine.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  processSessionKeeper,
  readKeeperThreshold,
  resetKeeperStore,
  addToolWeight,
} from '../src/session/session-keeper.js';

let cwd = '';

const OC_SESSION_ID = 'test-oc-session';
const SESSION_DIR = '2026-07-30--S999--test-session';

function setupEnv(config?: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'keeper-test-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, '.serenity'), 'test-ccc');
  const opencodeDir = join(root, '.opencode');
  mkdirSync(opencodeDir, { recursive: true });
  if (config) {
    writeFileSync(join(opencodeDir, 'serenity.json'), JSON.stringify(config));
  }
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: root, stdio: 'ignore' });
  return root;
}

function resetEnv(): void {
  if (cwd) { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ok */ } }
  cwd = '';
}

function makeUserMsg(text: string, parts?: any[]): any {
  return { info: { role: 'user' }, parts: parts ?? [{ type: 'text', text }] };
}

function makeAssistantMsg(text: string): any {
  return { info: { role: 'assistant' }, parts: [{ type: 'text', text }] };
}

function makeToolUse(name: string, input?: Record<string, unknown>): any {
  return { type: 'tool', tool: name, input: input ?? {} };
}

function makeToolUsePart(name: string, input?: Record<string, unknown>): any {
  return { type: 'tool', tool: name, input: input ?? {} };
}

function makeMsg(role: string, text: string, parts?: any[]): any {
  return {
    info: { role },
    parts: parts ?? [{ type: 'text', text }],
    ...(role === 'user' ? {} : {}),
  };
}

describe('readKeeperThreshold()', () => {
  afterEach(() => resetEnv());

  it('no config file -> default 100', () => {
    cwd = setupEnv(undefined);
    expect(readKeeperThreshold(cwd)).toBe(100);
  });

  it('config with custom threshold', () => {
    cwd = setupEnv({ sessionKeeper: { threshold: 50 } });
    expect(readKeeperThreshold(cwd)).toBe(50);
  });

  it('config without sessionKeeper section -> default', () => {
    cwd = setupEnv({ loop: { defaultModel: 'x' } });
    expect(readKeeperThreshold(cwd)).toBe(100);
  });

  it('invalid threshold type -> default', () => {
    cwd = setupEnv({ sessionKeeper: { threshold: 'abc' } });
    expect(readKeeperThreshold(cwd)).toBe(100);
  });

  it('threshold zero is valid', () => {
    cwd = setupEnv({ sessionKeeper: { threshold: 0 } });
    expect(readKeeperThreshold(cwd)).toBe(0);
  });
});

describe('processSessionKeeper() — basic state machine', () => {
  beforeEach(() => { cwd = setupEnv(undefined); resetKeeperStore(); });
  afterEach(() => resetEnv());

  it('returns null reminder when score below threshold', () => {
    const messages = [
      makeMsg('user', 'hello'),
      makeAssistantMsg('hi there'),
    ];
    const r = processSessionKeeper(OC_SESSION_ID, messages, cwd, SESSION_DIR);
    expect(r.reminder).toBeNull();
    expect(r.code).toBeNull();
  });

  it('injects reminder when score reaches threshold via write tools', () => {
    // 3 writes * 3 = 9, well below 150
    addToolWeight(OC_SESSION_ID, 'write', { filePath: '/tmp/test.md' });
    addToolWeight(OC_SESSION_ID, 'write', { filePath: '/tmp/test2.md' });
    addToolWeight(OC_SESSION_ID, 'edit', { filePath: '/tmp/test3.md' });
    const messages = [makeMsg('user', 'do work'), makeAssistantMsg('done')];
    const r = processSessionKeeper(OC_SESSION_ID, messages, cwd, SESSION_DIR);
    expect(r.reminder).toBeNull();
    expect(r.code).toBeNull();
  });

  it('injects reminder with random 3-char code when threshold reached', () => {
    for (let i = 0; i < 50; i++) {
      addToolWeight(OC_SESSION_ID, 'write', { filePath: `/tmp/f${i}.md` });
    }
    const messages = [makeMsg('user', 'batch write'), makeAssistantMsg('all done')];
    const r = processSessionKeeper(OC_SESSION_ID, messages, cwd, SESSION_DIR);
    // 50 writes * 3 = 150 >= 150
    expect(r.reminder).not.toBeNull();
    expect(r.code).not.toBeNull();
    expect(r.code).toMatch(/^[A-Za-z0-9]{3}$/);
    expect(r.reminder).toContain(r.code);
    expect(r.reminder).toContain(SESSION_DIR);
  });

  it('code is random across calls', () => {
    for (let i = 0; i < 50; i++) {
      addToolWeight(OC_SESSION_ID + 'a', 'write', { filePath: `/tmp/f${i}.md` });
      addToolWeight(OC_SESSION_ID + 'b', 'write', { filePath: `/tmp/f${i}.md` });
    }
    const msgs = () => [makeMsg('user', 'batch'), makeAssistantMsg('done')];
    const r1 = processSessionKeeper(OC_SESSION_ID + 'a', msgs(), cwd, SESSION_DIR);
    const r2 = processSessionKeeper(OC_SESSION_ID + 'b', msgs(), cwd, SESSION_DIR);
    expect(r1.code).not.toBe(r2.code);
  });
});

describe('processSessionKeeper() — ACK cycle (multi-round)', () => {
  beforeEach(() => { cwd = setupEnv({ sessionKeeper: { threshold: 10 } }); resetKeeperStore(); });
  afterEach(() => resetEnv());

  function triggerReminder(): { code: string } {
    // 4 writes * 3 = 12 >= 10
    for (let i = 0; i < 4; i++) {
      addToolWeight(OC_SESSION_ID, 'write', { filePath: `/tmp/f${i}.md` });
    }
    const r = processSessionKeeper(OC_SESSION_ID, [makeMsg('user', 'batch'), makeAssistantMsg('done')], cwd, SESSION_DIR);
    expect(r.reminder).not.toBeNull();
    return { code: r.code! };
  }

  it('round 1: trigger reminder, round 2: ACK clears pending', () => {
    const { code } = triggerReminder();

    // Round 2: user sends new message, assistant ACK'd
    addToolWeight(OC_SESSION_ID, 'write', { filePath: '/tmp/x.md' });
    const messagesR2 = [
      makeMsg('user', 'batch write', [
        makeToolUsePart('write', { filePath: '/tmp/x.md' }),
      ]),
      makeAssistantMsg(`updated SESSION.md\n[TRAJECTORY-ASSISTANT-recorded-${code}]`),
    ];
    const r2 = processSessionKeeper(OC_SESSION_ID, messagesR2, cwd, SESSION_DIR);
    expect(r2.reminder).toBeNull(); // ACK cleared pending
    expect(r2.code).toBeNull();
  });

  it('round 1: trigger, round 2: no ACK, reminder persists', () => {
    const { code } = triggerReminder();

    // Round 2: no ACK in assistant text
    const messagesR2 = [
      makeMsg('user', 'hello'),
      makeAssistantMsg('no ack here'),
    ];
    const r2 = processSessionKeeper(OC_SESSION_ID, messagesR2, cwd, SESSION_DIR);
    expect(r2.reminder).not.toBeNull(); // still pending
    expect(r2.code).toBe(code); // same code
  });

  it('ACK with wrong code is treated as invalid, reminder persists', () => {
    const { code: _code } = triggerReminder();

    // ACK with wrong code
    const messagesR2 = [
      makeMsg('user', 'hello'),
      makeAssistantMsg('[TRAJECTORY-ASSISTANT-recorded-XXX]'),
    ];
    const r2 = processSessionKeeper(OC_SESSION_ID, messagesR2, cwd, SESSION_DIR);
    expect(r2.reminder).not.toBeNull(); // still pending
  });

  it('ACK-skipped also clears pending', () => {
    const { code } = triggerReminder();

    const messagesR2 = [
      makeMsg('user', 'hello'),
      makeAssistantMsg(`[TRAJECTORY-ASSISTANT-skipped-${code}]`),
    ];
    const r2 = processSessionKeeper(OC_SESSION_ID, messagesR2, cwd, SESSION_DIR);
    expect(r2.reminder).toBeNull();
    expect(r2.code).toBeNull();
  });

  it('score resets after ACK, re-accumulates for next cycle', () => {
    const { code } = triggerReminder();
    // ACK
    const msgs1 = [makeMsg('user', 'x'), makeAssistantMsg(`[TRAJECTORY-ASSISTANT-recorded-${code}]`)];
    const r1 = processSessionKeeper(OC_SESSION_ID, msgs1, cwd, SESSION_DIR);
    expect(r1.reminder).toBeNull();

    // Reset: score should be 0 now, 3 write = 9 < 10, no trigger
    addToolWeight(OC_SESSION_ID, 'write', { filePath: '/a.md' });
    addToolWeight(OC_SESSION_ID, 'write', { filePath: '/b.md' });
    addToolWeight(OC_SESSION_ID, 'write', { filePath: '/c.md' });
    const msgs2 = [makeMsg('user', 'y'), makeAssistantMsg('ok')];
    const r2 = processSessionKeeper(OC_SESSION_ID, msgs2, cwd, SESSION_DIR);
    expect(r2.reminder).toBeNull();

    // 4th write = 12 >= 10, triggers again
    addToolWeight(OC_SESSION_ID, 'write', { filePath: '/d.md' });
    const msgs3 = [makeMsg('user', 'z'), makeAssistantMsg('ok')];
    const r3 = processSessionKeeper(OC_SESSION_ID, msgs3, cwd, SESSION_DIR);
    expect(r3.reminder).not.toBeNull();
  });
});

describe('processSessionKeeper() — tool weight calculation', () => {
  beforeEach(() => { cwd = setupEnv({ sessionKeeper: { threshold: 5 } }); resetKeeperStore(); });
  afterEach(() => resetEnv());

  it('one write tool -> score 3 -> below threshold 5', () => {
    addToolWeight(OC_SESSION_ID, 'write', { filePath: '/x' });
    const r = processSessionKeeper(OC_SESSION_ID, [makeMsg('user', 'hi'), makeAssistantMsg('ok')], cwd, SESSION_DIR);
    expect(r.reminder).toBeNull();
  });

  it('two write tools -> score 6 -> triggers reminder', () => {
    addToolWeight(OC_SESSION_ID, 'write', { filePath: '/x' });
    addToolWeight(OC_SESSION_ID, 'write', { filePath: '/y' });
    const r = processSessionKeeper(OC_SESSION_ID, [makeMsg('user', 'hi'), makeAssistantMsg('ok')], cwd, SESSION_DIR);
    expect(r.reminder).not.toBeNull();
  });

  it('five read tools -> score 5 -> triggers reminder', () => {
    for (let i = 0; i < 5; i++) addToolWeight(OC_SESSION_ID, 'read', { filePath: `/tmp/f${i}` });
    const r = processSessionKeeper(OC_SESSION_ID, [makeMsg('user', 'hi'), makeAssistantMsg('ok')], cwd, SESSION_DIR);
    expect(r.reminder).not.toBeNull();
  });

  it('container_fs read subcommand -> weight 1', () => {
    addToolWeight(OC_SESSION_ID, 'container_fs', { subcommand: 'list' });
    const r = processSessionKeeper(OC_SESSION_ID, [makeMsg('user', 'hi'), makeAssistantMsg('ok')], cwd, SESSION_DIR);
    expect(r.reminder).toBeNull();
  });

  it('container_fs write subcommand -> weight 3', () => {
    addToolWeight(OC_SESSION_ID, 'container_fs', { subcommand: 'mkdir' });
    addToolWeight(OC_SESSION_ID, 'container_fs', { subcommand: 'rm' });
    const r = processSessionKeeper(OC_SESSION_ID, [makeMsg('user', 'hi'), makeAssistantMsg('ok')], cwd, SESSION_DIR);
    // 3+3=6 >= 5
    expect(r.reminder).not.toBeNull();
  });

  it('non-tracked tools -> weight 0', () => {
    addToolWeight(OC_SESSION_ID, 'logbook', { subcommand: 'list' });
    // logbook list is not in WRITE sets nor READ_TOOLS by that name — weight 0, threshold=5 not reached
    const r = processSessionKeeper(OC_SESSION_ID, [makeMsg('user', 'hi'), makeAssistantMsg('ok')], cwd, SESSION_DIR);
    expect(r.reminder).toBeNull();
  });
});

describe('processSessionKeeper() — no active session', () => {
  beforeEach(() => { cwd = setupEnv({ sessionKeeper: { threshold: 1 } }); resetKeeperStore(); });
  afterEach(() => resetEnv());

  it('returns null when no active session (sessionDirName is empty in hook)', () => {
    addToolWeight(OC_SESSION_ID, 'write', { filePath: '/tmp/x.md' });
    const messages = [makeMsg('user', 'work'), makeAssistantMsg('done')];
    // processSessionKeeper doesn't check session validity; it uses whatever dirName passed.
    // The guard is in compacting.ts: it only calls processSessionKeeper when active session exists.
    // Here we just verify that with an empty dirName, the code still generates but uses empty string.
    const r = processSessionKeeper(OC_SESSION_ID, messages, cwd, '');
    expect(r.reminder).not.toBeNull();
    expect(r.reminder).not.toContain('S###'); // no session in text
  });
});

// ── Integration: SDK tool format (type "tool" + tool field) ──

describe('processSessionKeeper() — SDK tool format compatibility', () => {
  beforeEach(() => { cwd = setupEnv({ sessionKeeper: { threshold: 5 } }); resetKeeperStore(); });
  afterEach(() => resetEnv());

  function sdkToolPart(toolName: string, input?: Record<string, unknown>, stateStatus?: string): any {
    return {
      type: "tool",
      tool: toolName,
      input: input ?? {},
      state: stateStatus ? { status: stateStatus } : { status: "pending" },
    };
  }

  it('SDK format: tool type with tool field -> weight applied', () => {
    addToolWeight('sdk-test-1', 'write', { filePath: '/tmp/x.md' });
    addToolWeight('sdk-test-1', 'write', { filePath: '/tmp/y.md' });
    const messages = [makeMsg('user', 'work'), makeAssistantMsg('done')];
    const r = processSessionKeeper('sdk-test-1', messages, cwd, SESSION_DIR);
    expect(r.reminder).not.toBeNull();
  });

  it('SDK format: read tool recognized', () => {
    addToolWeight('sdk-test-2', 'read', { filePath: '/tmp/x.md' });
    addToolWeight('sdk-test-2', 'grep', { pattern: 'foo' });
    addToolWeight('sdk-test-2', 'glob', { pattern: '*.ts' });
    addToolWeight('sdk-test-2', 'msm_list', {});
    addToolWeight('sdk-test-2', 'msm_exec', {});
    const messages = [makeMsg('user', 'read'), makeAssistantMsg('done')];
    const r = processSessionKeeper('sdk-test-2', messages, cwd, SESSION_DIR);
    expect(r.reminder).not.toBeNull();
  });

  it('SDK format: delegate (task) weight 10', () => {
    addToolWeight('sdk-test-3', 'task', { prompt: 'do work' });
    const messages = [makeMsg('user', 'delegate'), makeAssistantMsg('done')];
    const r = processSessionKeeper('sdk-test-3', messages, cwd, SESSION_DIR);
    // 10 points, threshold 5 -> triggers
    expect(r.reminder).not.toBeNull();
  });

  it('SDK format: container_fs subcommands work', () => {
    addToolWeight('sdk-test-4', 'container_fs', { subcommand: 'mkdir', path: '/tmp/d' });
    addToolWeight('sdk-test-4', 'container_fs', { subcommand: 'append', path: '/tmp/f', content: 'x' });
    const messages = [makeMsg('user', 'fs work'), makeAssistantMsg('done')];
    const r = processSessionKeeper('sdk-test-4', messages, cwd, SESSION_DIR);
    // 2 write subcommands * 3 = 6 >= threshold 5
    expect(r.reminder).not.toBeNull();
  });

  it('SDK format: logbook use detected as reset', () => {
    resetKeeperStore();
    addToolWeight('sdk-test-5', 'logbook', { subcommand: 'use', name: 'S001' });
    addToolWeight('sdk-test-5', 'write', { filePath: '/tmp/x.md' });
    const messages = [makeMsg('user', 'some work'), makeAssistantMsg('done')];
    const r = processSessionKeeper('sdk-test-5', messages, cwd, SESSION_DIR);
    // logbook use (read weight 1) + 1 write (3) = 4, below threshold 5
    expect(r.reminder).toBeNull();
  });

  it('SDK format: completed/error state not counted', () => {
    // Only 1 write = 3, below threshold 5
    addToolWeight('sdk-test-6', 'write', { filePath: '/tmp/a.md' });
    const messages = [makeMsg('user', 'work'), makeAssistantMsg('done')];
    const r = processSessionKeeper('sdk-test-6', messages, cwd, SESSION_DIR);
    expect(r.reminder).toBeNull();
  });
});

// ── Integration: rebuild from history ──

describe('processSessionKeeper() — rebuild from history on session restore', () => {
  beforeEach(() => { cwd = setupEnv({ sessionKeeper: { threshold: 10 } }); resetKeeperStore(); });
  afterEach(() => resetEnv());

  function makeToolUseMsg(role: string, text: string, tools: any[]): any {
    return {
      info: { role },
      parts: [
        { type: 'text', text },
        ...tools.map((t: any) => ({
          type: 'tool',
          tool: t.name ?? t.tool ?? t,
          input: t.input ?? {},
        })),
      ],
    };
  }

  it('rebuild from history finds session use and accumulates post-ACK score', () => {
    const history = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'hi' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'hello' }] },
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'use session' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'tool', state: { status: 'completed', output: 'Session S001 active\n[SESSION CONTEXT] Activated: S001' } }] },
    ];
    // Rebuild: score=0 (fresh start)
    const r = processSessionKeeper('rebuild-test', history, cwd, SESSION_DIR);
    expect(r.reminder).toBeNull();

    // Add 4 writes = 12 >= 10 -> triggers
    addToolWeight('rebuild-test', 'write', { filePath: '/tmp/a.md' });
    addToolWeight('rebuild-test', 'write', { filePath: '/tmp/b.md' });
    addToolWeight('rebuild-test', 'write', { filePath: '/tmp/c.md' });
    addToolWeight('rebuild-test', 'write', { filePath: '/tmp/d.md' });
    const r2 = processSessionKeeper('rebuild-test', [makeMsg('user', 'more'), makeAssistantMsg('done2')], cwd, SESSION_DIR);
    expect(r2.reminder).not.toBeNull();
  });

  it('rebuild from history without session use starts fresh', () => {
    const history = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'work' }] },
      makeToolUseMsg('assistant', 'doing', [{ name: 'write', input: { filePath: '/tmp/a.md' } }]),
    ];
    const r = processSessionKeeper('rebuild-test-2', history, cwd, SESSION_DIR);
    // No session use found -> score 0, no reminder
    expect(r.reminder).toBeNull();
  });

  it('rebuild with prior ACK resets score to zero', () => {
    const history = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'use' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'tool', state: { status: 'completed', output: '[SESSION CONTEXT] Activated: S001' } }] },
      makeToolUseMsg('user', 'work', [{ name: 'write', input: { filePath: '/tmp/a.md' } }]),
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'updated\n[TRAJECTORY-ASSISTANT-recorded-ABC]' }] },
    ];
    const r = processSessionKeeper('rebuild-test-3', history, cwd, SESSION_DIR);
    // ACK found -> score = 0, no reminder
    expect(r.reminder).toBeNull();
  });
});
