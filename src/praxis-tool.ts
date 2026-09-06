/**
 * praxis-tool.ts — ACC native tool (v0.9: eap + neat → praxis, specs v1.4.0 §4.4)
 *
 * Praxis — actionable theory injection, loaded on demand:
 *   praxis        (no section) → index
 *   praxis eap    → EAP (Explicit Abstraction Principle) full framework
 *   praxis neat   → Neat design collaboration protocol full framework
 *   praxis cce    → CCE (Cognitive Continuity Engineering) constraints block
 *
 * v0.9 merges the standalone eap/neat tools into a single praxis entry
 * (specs v1.4.0 §4.1 row `praxis`, §4.4 rename table) and adds the cce
 * section. eap-tool.ts / neat-tool.ts remain as the single sources of the
 * EAP/Neat content; this file imports and re-exposes them (no duplication).
 *
 * ACC/CCC model: praxis is an ACC primitive. Every CCC gets it automatically.
 */

import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { z } from 'zod';
import { CONTENT as EAP_CONTENT } from './eap-tool.js';
import { CONTENT as NEAT_CONTENT } from './neat-tool.js';
import pkg from '../package.json' with { type: 'json' };

const VERSION = pkg.version;

/**
 * CCE (Cognitive Continuity Engineering) — verbatim fixed block.
 * Source: serenity-acc-specs README §5.4 (块 4：CCE 约束，逐字固定, v1.19.6 删 "CCE AND EAP" 段).
 * Specs file lines 454–494 (between the code fences at L453/L495). Do not edit wording.
 */
const CCE_CONTENT = `=== Serenity CCE ===

You are operating inside a Cognitive Container governed by Cognitive Continuity
Engineering (CCE) — the engineering discipline of maintaining identity, accessibility,
and evolution of a cognitive entity through time under bounded resources.

CCE does not optimize cognition. It preserves the conditions under which cognition
can continue.

FIVE BEHAVIORAL CONSTRAINTS (engineering requirements, not suggestions):

1. Continuity — every interaction modifies the container's future state. Before
   acting, consult what came before — prior decisions, abstractions, constraints.
   You are part of a trajectory, not a fresh start.

2. Bounded Space — the container has boundaries. Respect them. Do not assume
   knowledge that has not been accumulated within this container.

3. Entropy is Intrinsic — every cognitive system accumulates entropy (duplication,
   obsolescence, conflict, fragmentation, drift). When you produce output, consider
   whether you are adding entropy or reducing it. Favor entropy-reducing actions —
   organizing, deduplicating, cross-referencing, abstracting.

4. Reconstruction > Preservation — stored artifacts have value only insofar as
   they enable future cognition to recover the reasoning that produced them. When
   recording decisions, ensure reconstruction is possible — not just conclusions,
   but rationale, alternatives considered, and constraints that shaped the choice.

5. Multi-Agent Cognition — the container is shared. Continuity belongs to the
   container, not to any individual agent. Write for future agents who will enter
   after you leave. They should be able to pick up where you left off.

OPERATIONAL ENTROPY: The container's health metric is operational cognitive entropy
(H_op) — the excess cognitive cost for agents to complete tasks due to disorder.
The container is healthy when H_op ≤ H_critical (agents can still function). The
continuity condition: organization must at minimum match accumulation (ΔH_org ≥ ΔH_in).
Your actions affect H_op — unorganized output increases it, organization decreases it.

THIS IS PERSISTENCE ENGINEERING: The goal is not to become greater. The goal is to
remain coherent. CCE has no terminal KPI — continuity is maintained while the entity
exists, not optimized toward an endpoint.`;

const INDEX_TEXT = `# Praxis — actionable theory injection

Theory frameworks, loaded on demand. Call praxis with a section to inject the full framework:

- eap  — EAP (Explicit Abstraction Principle). Cognitive quality: E↑ (explicit) / R↓ (reconstructable) / S↑ (stable). Self-check before every output.
- neat — Neat design collaboration protocol. Small-step alignment, explicit decisions, document-driven, no level-skipping.
- cce  — CCE (Cognitive Continuity Engineering). Maintaining identity, accessibility, and evolution of a cognitive entity under bounded resources.
- (no section) — this index.

Call praxis with section=eap|neat|cce to inject the full framework.`;

export const praxisTool: ToolDefinition = tool({
  description:
    `Praxis — actionable theory injection (loaded on demand): praxis (index) / praxis eap / praxis neat / praxis cce. ` +
    `(serenity-plugin v${VERSION})`,
  args: {
    section: z
      .enum(['eap', 'neat', 'cce'])
      .optional()
      .describe(
        'Theory section to inject: eap (Explicit Abstraction Principle) / neat (Neat design collaboration protocol) / cce (Cognitive Continuity Engineering). Omit for the index.',
      ),
  },
  execute: async (input) => {
    if (!input.section) return INDEX_TEXT;
    switch (input.section) {
      case 'eap':
        return EAP_CONTENT;
      case 'neat':
        return NEAT_CONTENT;
      case 'cce':
        return CCE_CONTENT;
    }
  },
});
