/**
 * rebuild.test.ts — logbook rebuild 模块单测
 *
 * 覆盖：triggerRebuild（client 面/成功/失败/pending 设置）、
 *       resolveCurrentModel（消息解析/无 messages 能力/失败）、
 *       pending rebuild 消费链（set/consume/reset/peek）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  triggerRebuild,
  resolveCurrentModel,
  setPendingRebuild,
  consumePendingRebuild,
  resetPendingRebuild,
  peekPendingRebuild,
  type RebuildClient,
} from '../src/session/rebuild.js';

function makeClient(overrides?: Partial<RebuildClient>): RebuildClient {
  return {
    session: {
      summarize: async () => true,
      messages: async () => [],
      ...(overrides?.session ?? {}),
    },
  } as RebuildClient;
}

beforeEach(() => resetPendingRebuild());

describe('triggerRebuild', () => {
  it('client 无 summarize → 返回 ok:false', async () => {
    const r = await triggerRebuild({ session: {} } as RebuildClient, {
      sessionID: 'ses-1', providerID: 'p', modelID: 'm', summary: 'next phase',
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('summarize unavailable');
  });

  it('成功：调 summarize + 设 pending + ok:true', async () => {
    let called = false;
    const client = makeClient({
      session: {
        summarize: async (opts: { path: { id: string }; body: { providerID: string; modelID: string }; query?: { directory?: string } }) => {
          called = true;
          expect(opts.path.id).toBe('ses-1');
          expect(opts.body.providerID).toBe('deepseek');
          expect(opts.body.modelID).toBe('deepseek-v4-flash');
          expect(opts.query?.directory).toBe('/tmp/ccc');
          return true;
        },
      },
    });
    const r = await triggerRebuild(client, {
      sessionID: 'ses-1', providerID: 'deepseek', modelID: 'deepseek-v4-flash',
      summary: 'next phase', note: 'do x', directory: '/tmp/ccc',
    });
    expect(called).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('queued logbook rebuild');
    expect(peekPendingRebuild()).toEqual({
      sessionID: 'ses-1', summary: 'next phase', note: 'do x',
    });
  });

  it('summarize 抛错 → ok:false + message 含错误', async () => {
    const client = makeClient({
      session: {
        summarize: async () => { throw new Error('boom'); },
      },
    });
    const r = await triggerRebuild(client, {
      sessionID: 'ses-1', providerID: 'p', modelID: 'm', summary: 's',
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('boom');
  });
});

describe('resolveCurrentModel', () => {
  it('从最后 user message 的 model 解析', async () => {
    const client = makeClient({
      session: {
        messages: async () => [
          { info: { role: 'assistant', model: { providerID: 'a', modelID: 'a1' } } },
          { info: { role: 'user', model: { providerID: 'deepseek', modelID: 'v4' } } },
        ],
      },
    });
    const m = await resolveCurrentModel(client, 'ses-1', '/tmp/ccc');
    expect(m).toEqual({ providerID: 'deepseek', modelID: 'v4' });
  });

  it('无 user message → null', async () => {
    const client = makeClient({
      session: { messages: async () => [{ info: { role: 'assistant' } }] },
    });
    const m = await resolveCurrentModel(client, 'ses-1');
    expect(m).toBeNull();
  });

  it('无 messages 能力 → null', async () => {
    const client = { session: {} } as RebuildClient;
    const m = await resolveCurrentModel(client, 'ses-1');
    expect(m).toBeNull();
  });

  it('messages 抛错 → null（不炸）', async () => {
    const client = makeClient({
      session: { messages: async () => { throw new Error('x'); } },
    });
    const m = await resolveCurrentModel(client, 'ses-1');
    expect(m).toBeNull();
  });
});

describe('pending rebuild 消费链', () => {
  it('set → consume（同 session）返回并清空', () => {
    setPendingRebuild({ sessionID: 's1', summary: 'x', note: 'n' });
    const p = consumePendingRebuild('s1');
    expect(p).toEqual({ sessionID: 's1', summary: 'x', note: 'n' });
    expect(peekPendingRebuild()).toBeNull();
  });

  it('consume 不同 session → null 且不清空', () => {
    setPendingRebuild({ sessionID: 's1', summary: 'x' });
    expect(consumePendingRebuild('s2')).toBeNull();
    expect(peekPendingRebuild()).not.toBeNull();
  });

  it('reset 清空', () => {
    setPendingRebuild({ sessionID: 's1', summary: 'x' });
    resetPendingRebuild();
    expect(peekPendingRebuild()).toBeNull();
  });
});
