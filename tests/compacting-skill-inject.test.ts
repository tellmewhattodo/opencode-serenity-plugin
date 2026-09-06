/**
 * v0.9 9 块 system.transform 注入单测（specs v1.4.0 §5.0 装配顺序）
 *
 * 装配顺序（块 1-9）：
 *   ACC(0) → Metaphor(1) → Principles(2) → CCE(3) → EAP(4)
 *   → [状态块: safe-mode ON 条件](5) → SKILL 全文 → Tools → [Session: 活跃会话条件]
 *
 * 覆盖：
 * 1. plugin 激活 + skillContent 有值 → 7 块注入（ACC..EAP + SKILL + Tools）
 * 2. plugin 未激活 → 跳过（不注入）
 * 3. skillContent 为 null → ACC..EAP 5 块仍注入，SKILL/Tools 早退跳过
 * 4. 同一 session 多次调用 → 全块 dedup（不堆积）
 * 5. 不同 session → 各自独立注入
 * 6. Metaphor 块包含 10 条星舰隐喻（SHIP/VOYAGE/CREW 三层）
 * 7. CCE 块包含五项行为约束
 * 8. EAP 块包含 E↑/R↓/S↑ 三要点
 * 9. Principles 块承载 Root 边界 + MSM 原则（取代旧 === Serenity Constraints ===）
 * 10. safe-mode ON → 状态块注入（第 6 位），长度 +1
 * 11. 活跃会话 → Session 块注入（含 TRAJECTORY-ASSISTANT 预声明）
 * 12. session.compacting 仍注入状态（RR7 兼容保留）
 *
 * 注意：SKILL 块在 Tools 之前 return——无 skillContent 时只有
 * ACC/Metaphor/Principles/CCE/EAP 5 块（Tools + Session 均跳过）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setState, resetState, markReady } from '../src/state.js';
import { createCompactingHooks } from '../src/hooks/compacting.js';
import { INACTIVE_STATE, type SerenityState } from '../src/types/index.js';
import { setActiveSession } from '../src/session/active-state.js';

function makeState(overrides: Partial<SerenityState> = {}): SerenityState {
  return Object.freeze({
    activated: true,
    cwdRoot: '/repo',
    cccName: 'home-serenity',
    skillPath: '/repo/.opencode/skills/home-serenity/SKILL.md',
    skillContent: '# Mock SKILL.md\n\nThis is the test skill content.',
    ...overrides,
  });
}

describe('v0.9 9 块 system.transform 注入（specs v1.4.0 §5.0）', () => {
  beforeEach(() => {
    resetState();
    // 强制 safe-mode OFF（确定性基线：env 优先于 /tmp 状态与 server 模式检测）
    process.env.SERENITY_SAFE_MODE = 'false';
  });

  afterEach(() => {
    delete process.env.SERENITY_SAFE_MODE;
  });

  it('plugin 激活 + skillContent 有值 → 7 块注入（ACC..EAP + SKILL + Tools）', async () => {
    setState(makeState());
    markReady();
    const hooks = createCompactingHooks();
    const hook = hooks['experimental.chat.system.transform'];
    expect(hook).toBeDefined();

    const output = { system: [] as string[] };
    await hook!({ sessionID: 'sess-1' } as any, output);
    // 无活跃会话 + safe-mode OFF → 7 块，无 Session 块
    expect(output.system).toHaveLength(7);

    // [0] ACC 身份
    expect(output.system[0]).toContain('=== Serenity ACC ===');
    expect(output.system[0]).toContain('CCC: home-serenity');
    expect(output.system[0]).toMatch(/ACC: opencode-serenity-plugin v\d/);

    // [1] Metaphor 世界模型
    expect(output.system[1]).toContain('=== Serenity Metaphor ===');

    // [2] Principles 本体论/边界（Root 边界在此）
    expect(output.system[2]).toContain('=== Serenity Principles ===');
    expect(output.system[2]).toContain('Root: /repo');

    // [3] CCE 时间约束
    expect(output.system[3]).toContain('=== Serenity CCE ===');

    // [4] EAP 质量框架
    expect(output.system[4]).toContain('=== Serenity EAP ===');

    // [5] SKILL.md 全文（不截断，逐字）
    expect(output.system[5]).toBe('# Mock SKILL.md\n\nThis is the test skill content.');

    // [6] Tools 参考（v0.9 工具清单 + msm 单入口协议）
    expect(output.system[6]).toContain('=== Serenity Tools ===');
  });

  it('plugin 未激活 → 跳过（不注入）', async () => {
    setState(INACTIVE_STATE);
    const hooks = createCompactingHooks();
    const hook = hooks['experimental.chat.system.transform'];
    expect(hook).toBeDefined();

    const output = { system: [] as string[] };
    await hook!({ sessionID: 'sess-2' } as any, output);
    expect(output.system).toHaveLength(0);
  });

  it('skillContent 为 null（SKILL.md 读失败）→ ACC..EAP 5 块仍注入，SKILL/Tools 早退跳过', async () => {
    setState(makeState({ skillContent: null }));
    markReady();
    const hooks = createCompactingHooks();
    const hook = hooks['experimental.chat.system.transform'];
    expect(hook).toBeDefined();

    const output = { system: [] as string[] };
    await hook!({ sessionID: 'sess-3' } as any, output);
    // SKILL return 在 Tools 之前 → 只有 ACC/Metaphor/Principles/CCE/EAP = 5 块
    expect(output.system).toHaveLength(5);
    expect(output.system[0]).toContain('=== Serenity ACC ===');
    expect(output.system[1]).toContain('=== Serenity Metaphor ===');
    expect(output.system[2]).toContain('=== Serenity Principles ===');
    expect(output.system[2]).toContain('Root: /repo');
    expect(output.system[3]).toContain('=== Serenity CCE ===');
    expect(output.system[4]).toContain('=== Serenity EAP ===');
    // Tools / Session 均跳过
    const all = output.system.join('\n');
    expect(all).not.toContain('=== Serenity Tools ===');
  });

  it('同一 session 多次调用 → 全块 dedup（各只注入一次，length 7 不堆积）', async () => {
    setState(makeState());
    markReady();
    const hooks = createCompactingHooks();
    const hook = hooks['experimental.chat.system.transform']!;

    const output = { system: [] as string[] };
    await hook({ sessionID: 'sess-dedup' } as any, output);
    await hook({ sessionID: 'sess-dedup' } as any, output);
    await hook({ sessionID: 'sess-dedup' } as any, output);
    // ACC/Metaphor/Principles/CCE/EAP + SKILL + Tools = 7，不会堆积
    expect(output.system).toHaveLength(7);
    expect(output.system[0]).toContain('=== Serenity ACC ===');
    expect(output.system[2]).toContain('=== Serenity Principles ===');
    expect(output.system[5]).toContain('Mock SKILL.md');
    expect(output.system[6]).toContain('=== Serenity Tools ===');
    // SKILL 全文只出现一次
    const skillCount = output.system.filter((s) => s.includes('Mock SKILL.md')).length;
    expect(skillCount).toBe(1);
  });

  it('不同 session → 各自独立注入（各 7 块）', async () => {
    setState(makeState());
    markReady();
    const hooks = createCompactingHooks();
    const hook = hooks['experimental.chat.system.transform']!;

    const outputA = { system: [] as string[] };
    const outputB = { system: [] as string[] };
    await hook({ sessionID: 'sess-A' } as any, outputA);
    await hook({ sessionID: 'sess-B' } as any, outputB);
    expect(outputA.system).toHaveLength(7);
    expect(outputB.system).toHaveLength(7);
    expect(outputA.system[2]).toContain('=== Serenity Principles ===');
    expect(outputA.system[2]).toContain('Root: /repo');
    expect(outputA.system[5]).toContain('Mock SKILL.md');
    expect(outputB.system[2]).toContain('=== Serenity Principles ===');
    expect(outputB.system[2]).toContain('Root: /repo');
    expect(outputB.system[5]).toContain('Mock SKILL.md');
  });

  it('Metaphor 块包含 10 条星舰隐喻（SHIP/VOYAGE/CREW 三层）', async () => {
    setState(makeState());
    markReady();
    const hooks = createCompactingHooks();
    const hook = hooks['experimental.chat.system.transform']!;

    const output = { system: [] as string[] };
    await hook({ sessionID: 'sess-meta' } as any, output);
    const metaBlock = output.system[1]; // Metaphor block at index 1

    expect(metaBlock).toContain('=== Serenity Metaphor ===');
    expect(metaBlock).toContain('The Serenity Universe');
    // THE SHIP 层
    expect(metaBlock).toContain('1. The Hull');
    expect(metaBlock).toContain('5. The Manifest');
    // THE VOYAGE 层
    expect(metaBlock).toContain('6. Departure Inspection');
    expect(metaBlock).toContain('8. The Ship of Theseus');
    // THE CREW 层
    expect(metaBlock).toContain('9. Crew Rotation');
    expect(metaBlock).toContain('10. Blueprint over Statue');
    expect(metaBlock).toContain('THE CREW — multi-agent collaboration');
  });

  it('CCE block 包含五项行为约束', async () => {
    setState(makeState());
    markReady();
    const hooks = createCompactingHooks();
    const hook = hooks['experimental.chat.system.transform']!;

    const output = { system: [] as string[] };
    await hook({ sessionID: 'sess-cce' } as any, output);
    const cceBlock = output.system[3]; // CCE block is at index 3

    expect(cceBlock).toContain('=== Serenity CCE ===');
    expect(cceBlock).toContain('Cognitive Continuity');
    expect(cceBlock).toContain('FIVE BEHAVIORAL CONSTRAINTS');
    expect(cceBlock).toContain('Continuity');
    expect(cceBlock).toContain('Bounded Space');
    expect(cceBlock).toContain('Entropy is Intrinsic');
    expect(cceBlock).toContain('Reconstruction > Preservation');
    expect(cceBlock).toContain('Multi-Agent Cognition');
    expect(cceBlock).toContain('OPERATIONAL ENTROPY');
    expect(cceBlock).toContain('PERSISTENCE ENGINEERING');
  });

  it('EAP block 包含 E↑/R↓/S↑ 三要点', async () => {
    setState(makeState());
    markReady();
    const hooks = createCompactingHooks();
    const hook = hooks['experimental.chat.system.transform']!;

    const output = { system: [] as string[] };
    await hook({ sessionID: 'sess-eap' } as any, output);
    const eapBlock = output.system[4]; // EAP block is at index 4

    expect(eapBlock).toContain('=== Serenity EAP ===');
    expect(eapBlock).toContain('Explicit Abstraction Principle');
    expect(eapBlock).toContain('E↑ Explicit');
    expect(eapBlock).toContain('R↓ Reconstructable');
    expect(eapBlock).toContain('S↑ Stable');
  });

  it('Principles block 承载 Root 边界 + MSM 原则（取代旧 constraints block）', async () => {
    setState(makeState());
    markReady();
    const hooks = createCompactingHooks();
    const hook = hooks['experimental.chat.system.transform']!;

    const output = { system: [] as string[] };
    await hook({ sessionID: 'sess-all' } as any, output);
    const block = output.system[2]; // Principles block is at index 2

    expect(block).toContain('=== Serenity Principles ===');
    // 边界（原 === Serenity Constraints === 内容并入 Principles）
    expect(block).toContain('Root: /repo');
    expect(block).toContain('File access');
    expect(block).toContain('RR5');
    expect(block).toContain('bash may be disabled');
    expect(block).toContain('copies ALL parent constraints');
    expect(block).toContain('Session-first');
    // MSM 原则
    expect(block).toContain('MSM principles');
    expect(block).toContain('Registered to act');
    // 旧块名已删除
    expect(block).not.toContain('=== Serenity Constraints ===');
  });

  it('safe-mode ON → 状态块注入（第 6 位），长度 7 → 8', async () => {
    process.env.SERENITY_SAFE_MODE = 'true';
    setState(makeState());
    markReady();
    const hooks = createCompactingHooks();
    const hook = hooks['experimental.chat.system.transform']!;

    const output = { system: [] as string[] };
    await hook({ sessionID: 'sess-safe' } as any, output);
    // ACC/Metaphor/Principles/CCE/EAP + SafeMode + SKILL + Tools = 8
    expect(output.system).toHaveLength(8);
    expect(output.system[5]).toContain('=== Serenity Safe Mode ===');
    expect(output.system[5]).toContain('Safe mode is ON');
    expect(output.system[6]).toBe('# Mock SKILL.md\n\nThis is the test skill content.');
    expect(output.system[7]).toContain('=== Serenity Tools ===');
  });

  it('活跃会话 → Session 块注入（含 TRAJECTORY-ASSISTANT 预声明）', async () => {
    setState(makeState());
    markReady();
    // 为当前 OpenCode session 注册活跃 serenity session → 块 9 注入
    setActiveSession('sess-act', {
      sessionId: 'S999',
      dirName: '2026-09-06--S999--sample-session',
      mdPath: '/repo/AGENT_SESSIONS/2026-09-06--S999--sample-session/SESSION.md',
    });
    const hooks = createCompactingHooks();
    const hook = hooks['experimental.chat.system.transform']!;

    const output = { system: [] as string[] };
    await hook({ sessionID: 'sess-act' } as any, output);
    // 7 块 + Session = 8
    expect(output.system).toHaveLength(8);
    expect(output.system[7]).toContain('=== Serenity Session ===');
    expect(output.system[7]).toContain('Active session: S999 — 2026-09-06--S999--sample-session');
    expect(output.system[7]).toContain('SESSION.md path: /repo/AGENT_SESSIONS/2026-09-06--S999--sample-session/SESSION.md');
    expect(output.system[7]).toContain('TRAJECTORY-ASSISTANT');
    expect(output.system[7]).toContain('[TRAJECTORY-ASSISTANT-recorded-');
  });

  it('session.compacting 仍注入状态（RR7 兼容保留）', async () => {
    setState(makeState());
    markReady();
    const hooks = createCompactingHooks();
    const hook = hooks['experimental.session.compacting']!;

    const output = { context: [] as string[] };
    await hook({ sessionID: 'sess-c1' } as any, output);
    expect(output.context.length).toBeGreaterThan(0);
    expect(output.context[0]).toContain('cwdRoot=/repo');
    expect(output.context[0]).toContain('cccName=home-serenity');
  });
});
