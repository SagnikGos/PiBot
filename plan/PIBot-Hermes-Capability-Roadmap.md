# PπBot — Hermes-Level Architecture & Capability Upgrade Plan

> **Purpose:** This document is an implementation blueprint for evolving PπBot from a solid MVP coding-agent loop into a modular, persistent, extensible coding-agent runtime inspired by the architectural patterns of Hermes Agent.
>
> **Scope:** This document focuses on architecture, runtime boundaries, data flow, modules, interfaces, migration order, and acceptance criteria. It is intentionally written so it can be added to the PπBot repository as an engineering design document.

---

## 1. Executive Summary

PπBot already has a strong foundation:

- TypeScript + ESM
- CLI + interactive REPL
- Think → Act → Observe agent loop
- Conversation state
- Dynamic tool registry
- JSON-schema-based tool validation
- File and terminal tools
- Path sandboxing
- Human approval for dangerous commands
- Multi-provider abstraction
- Streaming model responses

The main limitation is not the lack of individual tools. The current architecture is still centered around a relatively monolithic runtime where conversation state, context construction, model invocation, tool execution, safety, and UI concerns are closely coupled.

The next architectural step is to turn PπBot into a **general agent runtime** with explicit subsystems:

```text
Interfaces
    ↓
Agent Runtime
    ├── Conversation Loop
    ├── Context Engine
    ├── Tool Runtime
    ├── Provider Runtime
    ├── Safety / Policy Engine
    ├── Execution Runtime
    ├── Session Store
    └── Event Bus

Cross-cutting capabilities
    ├── Memory
    ├── Skills
    ├── Tasks / Planning
    ├── Verification
    ├── Checkpoints
    ├── Subagents
    ├── MCP
    └── Plugins
```

The desired result is a system where:

- the **agent core does not know about the CLI**;
- the **tools do not know which LLM provider is being used**;
- the **filesystem tools do not own process execution**;
- the **conversation loop does not own persistence**;
- the **context system owns token budgeting and compression**;
- the **runtime owns policy and lifecycle decisions**;
- the **UI receives events instead of being coupled to internal runtime logic**;
- new providers, tools, execution backends, skills, integrations, and interfaces can be added without rewriting the core loop.

---

# 2. Current PπBot Architecture

## 2.1 Current modules

```text
src/
├── index.ts
├── repl.ts
│
├── core/
│   ├── agent-runtime.ts
│   ├── conversation-state.ts
│   ├── context-builder.ts
│   └── tool-registry.ts
│
├── providers/
│   ├── base-provider.ts
│   ├── provider-registry.ts
│   ├── gemini.ts
│   ├── anthropic.ts
│   └── openai.ts
│
├── safety/
│   ├── human-confirm.ts
│   └── path-sandbox.ts
│
├── tools/
│   ├── _base-tool.ts
│   ├── read-file.ts
│   ├── write-file.ts
│   ├── edit-file.ts
│   ├── list-directory.ts
│   ├── search-codebase.ts
│   └── execute-command.ts
│
└── types/
```

## 2.2 Current runtime

```text
CLI
 ↓
REPL
 ↓
AgentRuntime
 ├── ContextBuilder
 ├── ConversationState
 ├── ToolRegistry
 ├── Human Confirmation
 └── ProviderRegistry
      ↓
     LLM
      ↓
   Tool calls
      ↓
 ToolRegistry
      ↓
 Built-in tools
      ↓
 PathSandbox / command approval
      ↓
 Results
      ↓
 ConversationState
      ↓
 Next model turn
```

## 2.3 What is already good

The following concepts should be preserved:

### Agent loop

The Think → Act → Observe pattern is correct for a coding agent.

### Tool registry

Dynamic discovery and schema validation provide a good foundation for an extensible tool system.

### Edit semantics

Exact-match surgical edits are preferable to blindly rewriting whole files.

### Safety primitives

A path sandbox and human confirmation layer are essential and should remain first-class concepts.

### Provider abstraction

Provider-specific API details are already separated from the main runtime.

### Streaming

Streaming model output and tool progress is important for interactive developer workflows.

---

# 3. Current Architectural Gaps

PπBot should not be rewritten from scratch. Instead, the current modules should be split along stronger runtime boundaries.

## 3.1 Monolithic AgentRuntime

Current responsibility is approximately:

```text
AgentRuntime
 ├── conversation loop
 ├── context handling
 ├── model invocation
 ├── tool orchestration
 ├── safety checks
 ├── iteration management
 └── completion handling
```

This becomes difficult to evolve because every new capability has to enter the same class.

### Required change

Refactor `AgentRuntime` into a thin orchestrator over independent services.

Target:

```text
AgentRuntime
 ├── ConversationLoop
 ├── ContextEngine
 ├── ToolRuntime
 ├── ProviderRuntime
 ├── PolicyEngine
 ├── ExecutionRuntime
 ├── SessionStore
 └── EventBus
```

---

## 3.2 ConversationState is only working memory

Current `ConversationState` is doing double duty as both conversation history and active model context.

These are not the same concern.

### Required change

Split:

```text
ConversationState
```

into:

```text
WorkingContext
```

and:

```text
SessionStore
```

Working context answers:

> What should be in the next model request?

SessionStore answers:

> What has happened in this session historically?

---

## 3.3 ContextBuilder needs to become ContextEngine

The current prompt builder is useful but too static for long-running tasks.

It needs ownership of:

- prompt assembly
- project instructions
- token budgeting
- context references
- memory context
- skills context
- context compression
- preservation rules
- context snapshots

---

## 3.4 Tool registry needs execution orchestration

A registry alone is insufficient once tools require:

- approvals
- concurrency
- timeouts
- cancellation
- toolsets
- execution backends
- retries
- structured outputs
- lifecycle hooks

The registry should remain responsible for **discovery and metadata**, while a new `ToolRuntime` owns execution.

---

## 3.5 `execute_command` owns too much responsibility

The command tool should describe the action. It should not define how processes are spawned, streamed, cancelled, isolated, monitored, or killed.

Introduce an `ExecutionRuntime`.

---

## 3.6 REPL is too close to the runtime

The REPL should render runtime events rather than invoke internal implementation details directly.

This is necessary for future:

- web UI
- WebSocket API
- VS Code extension
- gateway
- ACP
- Discord / Telegram adapters

---

# 4. Target Architecture

## 4.1 High-level target architecture

```text
                                      PπBot Runtime

┌──────────────────────────────────────────────────────────────────────────┐
│                           Interface Layer                                 │
│                                                                          │
│   CLI / REPL   HTTP API   WebSocket   ACP   Gateway   Batch   Cron       │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           Agent Runtime                                  │
│                                                                          │
│  ConversationLoop   TurnLifecycle   Cancellation   Budgets   Retries     │
└───────┬──────────────────┬────────────────────┬─────────────────────────┘
        │                  │                    │
        ▼                  ▼                    ▼
┌──────────────┐   ┌──────────────┐    ┌────────────────┐
│ ContextEngine│   │ ToolRuntime  │    │ ProviderRuntime│
│              │   │              │    │                │
│ prompt       │   │ registry     │    │ resolver       │
│ memory       │   │ dispatch     │    │ profiles       │
│ skills       │   │ approvals    │    │ capabilities   │
│ project ctx  │   │ concurrency  │    │ fallback       │
│ compression  │   │ lifecycle    │    │ routing        │
│ token budget │   │              │    │                │
└──────┬───────┘   └──────┬───────┘    └────────┬───────┘
       │                  │                     │
       └──────────────────┼─────────────────────┘
                          ▼
                ┌─────────────────────┐
                │ Policy / Safety     │
                │                     │
                │ path policy         │
                │ command policy      │
                │ approvals           │
                │ secret handling     │
                │ network policy      │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ ExecutionRuntime    │
                │                     │
                │ Local               │
                │ Docker              │
                │ Remote              │
                │ Process Manager     │
                └──────────┬──────────┘
                           │
                           ▼
                       Workspace

┌──────────────────────────────────────────────────────────────────────────┐
│ Persistence                                                               │
│                                                                          │
│ SessionStore │ MessageStore │ EventStore │ Search/FTS │ MemoryStore      │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│ Extensibility                                                             │
│                                                                          │
│ Skills │ Plugins │ MCP │ Subagents │ Custom Tools │ Custom Providers     │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│ Event Bus                                                                 │
│                                                                          │
│ model streaming │ tool progress │ approvals │ compression │ lifecycle    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

# 5. Module-by-Module Changes

# 5.1 Agent Runtime

## Current

`src/core/agent-runtime.ts`

## Target

```text
src/agent/
├── agent-runtime.ts
├── conversation-loop.ts
├── turn-runner.ts
├── turn-result.ts
├── cancellation.ts
└── agent-events.ts
```

## Responsibilities

### `AgentRuntime`

Composition/orchestration only.

It should:

1. load session
2. create a turn
3. invoke conversation loop
4. return a final result

It should NOT:

- build raw prompts
- render CLI output
- execute shell commands directly
- access provider-specific APIs
- write SQLite queries directly

### `ConversationLoop`

Owns:

- iteration lifecycle
- model call
- response parsing
- tool-call handling
- continuation
- stop conditions
- max-iteration handling

### `TurnRunner`

Owns a single logical turn.

Suggested flow:

```text
Turn Started
 ↓
Context Preflight
 ↓
Build Request
 ↓
Resolve Provider
 ↓
Generate Response
 ↓
Parse Response
 ↓
Tool Calls?
 ├── No → Finalize
 └── Yes
       ↓
    Policy Check
       ↓
    Execute Tools
       ↓
    Persist Results
       ↓
    Observe
       ↓
    Context Pressure Check
       ↓
    Next iteration
```

---

# 5.2 Event Bus

Add:

```text
src/events/
├── event-bus.ts
├── event-types.ts
└── subscribers/
```

## Event types

```ts
export type AgentEvent =
  | { type: "session.started"; sessionId: string }
  | { type: "turn.started"; sessionId: string; turnId: string }
  | { type: "model.started"; model: string }
  | { type: "model.delta"; text: string }
  | { type: "model.completed"; usage?: Usage }
  | { type: "tool.started"; toolCallId: string; name: string }
  | { type: "tool.stdout"; toolCallId: string; chunk: string }
  | { type: "tool.completed"; toolCallId: string; result: ToolResult }
  | { type: "approval.requested"; approvalId: string }
  | { type: "approval.resolved"; approvalId: string; approved: boolean }
  | { type: "context.compressed"; before: number; after: number }
  | { type: "turn.completed"; turnId: string }
  | { type: "agent.error"; error: AgentError };
```

## Why

Once events exist, the REPL becomes a renderer rather than part of the runtime.

---

# 5.3 Context Engine

## Current

`src/core/context-builder.ts`

## Target

```text
src/context/
├── context-engine.ts
├── prompt-builder.ts
├── project-context.ts
├── memory-context.ts
├── skill-context.ts
├── context-references.ts
├── token-budget.ts
├── context-compressor.ts
└── preservation-policy.ts
```

## Responsibilities

The ContextEngine should answer:

> What exact information belongs in the next model request?

It should construct context from:

```text
System identity
+ project instructions
+ environment metadata
+ tool descriptions
+ skill summaries
+ memory snapshot
+ relevant session history
+ current working context
+ referenced files/folders
+ current git state (when requested)
+ volatile runtime information
```

## Prompt tiers

Separate context into:

```text
Stable
 ├── identity
 ├── core instructions
 ├── tool usage rules
 └── stable capability descriptions

Project
 ├── AGENTS.md
 ├── .pibot/agent.md
 └── inherited project instructions

Durable
 ├── MEMORY.md
 └── USER.md

Historical
 └── retrieved session messages

Volatile
 ├── current task
 ├── current iteration
 ├── current cwd
 ├── current model
 └── current runtime status
```

Stable content should change as little as possible because prompt-cache stability matters.

---

# 5.4 Token Budgeting

Create:

```ts
interface TokenBudget {
  maxContextTokens: number;
  reservedOutputTokens: number;
  systemTokens: number;
  projectTokens: number;
  memoryTokens: number;
  skillTokens: number;
  toolTokens: number;
  historyTokens: number;
  availableHistoryTokens: number;
}
```

Do not rely solely on:

```ts
if (estimatedTokens > 80_000)
```

Instead calculate the complete request budget.

Example:

```text
Context Window:        128k
Reserved Output:        16k
--------------------------------
Available Input:       112k

System:                  8k
Project:                 4k
Memory:                  2k
Skills:                  2k
Tools:                   8k
History:                70k
Working buffer:          8k
Safety reserve:         10k
--------------------------------
Total:                 112k
```

---

# 5.5 Context Compression

Replace the current sliding-window-only pruning with a dedicated compressor.

## Initial algorithm

```text
Original task
   ↓
Project context
   ↓
Summary of older history
   ↓
Recent tool-call/result pairs
   ↓
Recent user/assistant turns
```

The compressor should preserve:

- original objective
- unresolved requirements
- important architectural decisions
- files modified
- tests run
- failed commands
- known failures
- active task state
- important tool results

It should remove:

- repeated tool output
- stale exploratory details
- redundant conversational text
- superseded decisions

## Required interface

```ts
interface ContextEngine {
  build(input: ContextBuildInput): Promise<ModelContext>;
  estimateTokens(context: ModelContext): number;
  shouldCompress(context: ModelContext): boolean;
  compress(context: ModelContext): Promise<ModelContext>;
}
```

---

# 5.6 Session Persistence

## New directory

```text
src/persistence/
├── session-store.ts
├── message-store.ts
├── event-store.ts
├── sqlite-store.ts
└── search-store.ts
```

## Storage

Use SQLite initially.

Recommended tables:

```text
sessions
messages
tool_calls
tool_results
session_events
session_usage
session_lineage
state_meta
```

Add FTS5 for message search:

```text
messages_fts
```

## Distinction

```text
SessionStore
    = persistence

WorkingContext
    = what the model currently sees
```

## Suggested session model

```ts
interface Session {
  id: string;
  parentSessionId?: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
  provider: string;
  model: string;
  status: "active" | "completed" | "failed" | "cancelled";
}
```

## Session search

Expose a tool such as:

```text
session_search(query)
```

It should support exact search across prior sessions/messages.

---

# 5.7 Memory System

Add:

```text
src/memory/
├── memory-store.ts
├── memory-manager.ts
└── user-profile.ts
```

Use bounded durable files initially:

```text
.pibot/
├── MEMORY.md
└── USER.md
```

Concept:

```text
MEMORY.md
= project/environment knowledge

USER.md
= user preferences/work style
```

Memory should be loaded as a session-start snapshot rather than mutated inside every active prompt automatically.

Persist actual session history separately.

Recommended tools:

```text
memory_read
memory_write
memory_search
```

Later, support pluggable external memory providers.

---

# 5.8 Project Context Discovery

Add automatic discovery for project instruction files.

Recommended support:

```text
AGENTS.md
CLAUDE.md
.pibot/agent.md
.pibot/instructions.md
```

Directory inheritance:

```text
repo/AGENTS.md
repo/backend/AGENTS.md
repo/backend/src/auth.ts
```

An operation against `src/auth.ts` should inherit applicable parent instructions.

The loader should define deterministic precedence and conflict rules.

Suggested order:

```text
Global
 ↓
Repository
 ↓
Subdirectory
 ↓
File-specific context
 ↓
Current user task
```

---

# 5.9 Skills System

Add:

```text
src/skills/
├── skill-registry.ts
├── skill-loader.ts
├── skill-manager.ts
└── skill-types.ts
```

Directory example:

```text
skills/
├── react-debugging/
│   └── SKILL.md
├── github-pr/
│   └── SKILL.md
├── docker-debugging/
│   └── SKILL.md
└── database-migration/
    └── SKILL.md
```

## Progressive disclosure

Do NOT place every skill's entire documentation into the system prompt.

Use:

```text
Skill index
  ↓
model decides skill is relevant
  ↓
load full SKILL.md
  ↓
optionally load references/scripts
```

Suggested tools:

```text
list_skills
read_skill
```

Later:

```text
create_skill
update_skill
```

with optional human approval.

---

# 5.10 Tool Runtime

Keep the existing registry, but introduce a runtime layer.

```text
src/tools/
├── registry.ts
├── tool-runtime.ts
├── dispatcher.ts
├── toolsets.ts
├── lifecycle-hooks.ts
└── builtins/
```

## Registry responsibility

The registry owns:

- tool discovery
- metadata
- JSON schema
- tool name
- toolset membership
- handler reference
- capability metadata

## ToolRuntime responsibility

The runtime owns:

- schema validation
- policy checks
- approvals
- concurrency
- cancellation
- timeouts
- retries
- lifecycle events
- result normalization

---

# 5.11 Toolsets

Group tools by domain.

```text
filesystem
├── read_file
├── write_file
├── edit_file
└── list_directory

search
└── search_codebase

terminal
├── execute_command
├── process_list
├── process_logs
└── process_kill

git
├── git_status
├── git_diff
├── git_log
├── git_commit
└── git_branch

session
└── session_search

memory
├── memory_read
├── memory_write
└── memory_search

skills
├── list_skills
└── read_skill
```

This allows configuration such as:

```ts
const enabledToolsets = [
  "filesystem",
  "terminal",
  "git",
  "session",
];
```

---

# 5.12 Execution Runtime

## Current

`execute-command.ts` invokes the local shell directly.

## Target

```text
src/execution/
├── execution-runtime.ts
├── execution-backend.ts
├── local-executor.ts
├── docker-executor.ts
├── process-manager.ts
└── execution-types.ts
```

## Interface

```ts
interface ExecutionBackend {
  execute(
    command: string,
    options: ExecutionOptions,
  ): Promise<ExecutionResult>;
}
```

## Execution lifecycle

```text
Tool call
 ↓
Tool validation
 ↓
Policy evaluation
 ↓
Human approval if required
 ↓
Execution backend
 ↓
stdout/stderr streaming
 ↓
exit code
 ↓
structured result
 ↓
agent
```

## Backends

Initial:

```text
LocalExecutor
```

Later:

```text
DockerExecutor
RemoteExecutor
SSHExecutor
```

---

# 5.13 Process Manager

This is necessary for long-running development commands.

Support:

```text
spawn
list
logs
wait
kill
signal
status
```

Example lifecycle:

```text
npm run dev
   ↓
PID 8124
   ↓
process_list()
   ↓
process_logs(8124)
   ↓
process_kill(8124)
```

The tool should not rely on a single synchronous `exec()` operation for all workloads.

---

# 5.14 Patch / File Editing System

The current exact-match `edit_file` tool is a good base.

Evolve it into a patch-capable subsystem.

Suggested operations:

```text
preview_patch
apply_patch
validate_patch
rollback_patch
```

Support:

- exact replacement
- multiple hunks
- unified diff generation
- file existence checks
- expected-match counts
- optional preconditions

Example patch model:

```ts
interface FilePatch {
  file: string;
  hunks: PatchHunk[];
}

interface PatchHunk {
  oldText: string;
  newText: string;
  expectedMatches?: number;
}
```

A patch must fail if preconditions are not satisfied.

---

# 5.15 Git Integration

For a coding agent, Git should become a first-class subsystem.

Add tools:

```text
git_status
git_diff
git_log
git_show
git_branch
git_checkout
git_commit
```

Dangerous operations should still pass through the policy engine.

Examples requiring stronger approval:

```text
git push
git reset --hard
git clean -fd
git checkout --
```

---

# 5.16 Checkpoints / Rollback

Before broad modifications, create a checkpoint.

Initial implementation can use Git.

```text
Checkpoint
├── id
├── timestamp
├── sessionId
├── gitRef / patch snapshot
├── modified files
└── description
```

Flow:

```text
Before edit
 ↓
create checkpoint
 ↓
apply changes
 ↓
run tests
 ↓
failure?
 ├── yes → rollback
 └── no → keep changes
```

Expose:

```text
checkpoint_create
checkpoint_list
checkpoint_rollback
```

---

# 5.17 Task / Todo System

Add:

```text
src/tasks/
├── task-manager.ts
├── task-store.ts
└── task-types.ts
```

Use it to represent multi-step work.

Example:

```text
TASK-1  Inspect repository          completed
TASK-2  Refactor auth               completed
TASK-3  Update tests                running
TASK-4  Run integration suite       pending
```

Suggested task states:

```text
pending
in_progress
blocked
completed
failed
cancelled
```

The task manager should be persisted with the session.

---

# 5.18 Verification Engine

Verification must be a first-class concept rather than an accidental consequence of using the terminal tool.

Add:

```text
src/verification/
├── verification-engine.ts
├── test-discovery.ts
└── verification-types.ts
```

Conceptual cycle:

```text
Understand
 ↓
Plan
 ↓
Inspect
 ↓
Edit
 ↓
Run verification
 ↓
Observe failure
 ↓
Fix
 ↓
Run verification again
 ↓
Pass
```

The runtime should track:

```ts
interface VerificationResult {
  passed: boolean;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}
```

Verification commands can initially be inferred from `package.json`, common project files, and user configuration.

---

# 5.19 Provider Runtime

## Current

`ProviderRegistry` + `BaseProvider`.

## Target

```text
src/providers/
├── provider-runtime.ts
├── provider-registry.ts
├── provider-profile.ts
├── model-router.ts
├── retry-policy.ts
├── capabilities.ts
├── base-provider.ts
└── adapters/
```

Provider resolution should return a normalized runtime profile.

```ts
interface ProviderProfile {
  provider: string;
  model: string;
  apiMode: "chat_completions" | "responses" | "anthropic_messages";
  baseUrl: string;
  capabilities: ModelCapabilities;
  fallbackModels: ModelRef[];
}
```

## Model capabilities

```ts
interface ModelCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
  maxContextTokens: number;
}
```

---

# 5.20 Retries and Fallback

Classify provider failures:

```text
RATE_LIMIT
TIMEOUT
AUTH_ERROR
BAD_REQUEST
CONTEXT_TOO_LARGE
SERVER_ERROR
NETWORK_ERROR
```

Suggested behavior:

```text
401 / auth failure
    → do not blindly retry

429
    → exponential backoff

5xx
    → retry with limits

timeout
    → retry or fallback

context overflow
    → compress before retry
```

Do not put retry behavior into individual provider adapters.

It belongs in `ProviderRuntime`.

---

# 5.21 Model Routing

Once `ProviderRuntime` exists, add lightweight model routing.

Example:

```text
Complex planning
    → stronger model

Simple file edit
    → faster model

Context compression
    → cheaper summarizer

Subagent
    → cost-efficient model
```

This should be configuration-driven, not hard-coded by tool.

---

# 5.22 Subagent Runtime

Only implement this after persistence, context, tool, and execution layers are stable.

Add:

```text
src/agents/
├── subagent-runtime.ts
├── delegation-manager.ts
├── worker-pool.ts
└── subagent-types.ts
```

Architecture:

```text
Parent Agent
     ↓
DelegationManager
 ┌───┼────┐
 ▼   ▼    ▼
A    B    C
│    │    │
└────┼────┘
     ▼
worker summaries
     ↓
Parent Agent
```

Each subagent should get isolated:

- context
- iteration budget
- task ID
- tool execution context
- optional workspace scope

The parent should receive a concise structured result, not the entire child transcript.

---

# 5.23 Plugin System

Add only when the internal interfaces stabilize.

```text
src/plugins/
├── plugin-runtime.ts
├── plugin-registry.ts
└── plugin-types.ts
```

Plugin interface:

```ts
interface PibotPlugin {
  name: string;
  version: string;

  register(context: PluginContext): void | Promise<void>;
}
```

Plugins may eventually contribute:

- tools
- toolsets
- providers
- memory providers
- context engines
- hooks
- commands

Core should depend on interfaces, not specific integrations.

---

# 5.24 MCP Integration

Add MCP after the internal tool model is stable.

Architecture:

```text
ToolRuntime
   ├── builtin registry
   ├── plugin tools
   └── MCP client
          ↓
      external servers
```

Treat MCP tools as untrusted external capabilities until policy approval is applied.

Important safeguards:

- credential filtering
- server allowlist
- tool allowlist
- per-session scope
- execution policy
- timeouts

---

# 5.25 Gateway / API Layer

Do not build platform integrations until the runtime is transport-agnostic.

Introduce:

```text
src/interfaces/
├── agent-transport.ts
├── cli-adapter.ts
├── http-adapter.ts
├── websocket-adapter.ts
└── gateway-adapter.ts
```

Common interface:

```ts
interface AgentTransport {
  receive(): AsyncIterable<InboundMessage>;
  send(message: OutboundMessage): Promise<void>;
}
```

The runtime should consume normalized messages independent of transport.

---

# 5.26 Cron / Scheduled Agents

Later add:

```text
src/scheduler/
├── scheduler.ts
├── job-store.ts
└── job-runner.ts
```

A scheduled job should invoke the normal agent runtime.

```text
Scheduler
 ↓
Job
 ↓
AgentRuntime
 ↓
new/fresh session
 ↓
agent execution
 ↓
result delivery
```

Do not create a second agent implementation for scheduled work.

---

# 5.27 Context References

Add explicit user context references.

Examples:

```text
@src/auth/service.ts
@src/components/
@git-diff
@git-status
```

Architecture:

```text
User Input
 ↓
ReferenceParser
 ↓
ContextResolver
 ↓
ContextEngine
 ↓
Model request
```

This can dramatically improve usability for coding workflows.

---

# 5.28 Security / Policy Engine

The existing `PathSandbox` and `human-confirm` should remain, but become part of a unified policy layer.

Add:

```text
src/safety/
├── policy-engine.ts
├── policy-types.ts
├── path-policy.ts
├── command-policy.ts
├── network-policy.ts
├── secret-policy.ts
├── approval-manager.ts
└── path-sandbox.ts
```

## Policy decision

```ts
interface PolicyDecision {
  action: "allow" | "deny" | "approve";
  reason: string;
  rule?: string;
}
```

## Safety stack

```text
Tool schema validation
        ↓
Policy evaluation
        ↓
Path validation
        ↓
Command validation
        ↓
Approval requirement
        ↓
Execution isolation
```

Never trust the LLM itself as the security layer.

---

# 6. Recommended New Repository Layout

After the major refactor, aim for something close to:

```text
src/
├── app/
│   ├── cli.ts
│   ├── repl.ts
│   └── commands/
│
├── agent/
│   ├── agent-runtime.ts
│   ├── conversation-loop.ts
│   ├── turn-runner.ts
│   ├── cancellation.ts
│   └── agent-events.ts
│
├── context/
│   ├── context-engine.ts
│   ├── prompt-builder.ts
│   ├── project-context.ts
│   ├── memory-context.ts
│   ├── skill-context.ts
│   ├── context-references.ts
│   ├── token-budget.ts
│   ├── context-compressor.ts
│   └── preservation-policy.ts
│
├── providers/
│   ├── provider-runtime.ts
│   ├── provider-registry.ts
│   ├── provider-profile.ts
│   ├── model-router.ts
│   ├── retry-policy.ts
│   ├── capabilities.ts
│   ├── base-provider.ts
│   └── adapters/
│
├── tools/
│   ├── registry.ts
│   ├── dispatcher.ts
│   ├── tool-runtime.ts
│   ├── toolsets.ts
│   ├── lifecycle-hooks.ts
│   └── builtins/
│
├── execution/
│   ├── execution-runtime.ts
│   ├── execution-backend.ts
│   ├── local-executor.ts
│   ├── docker-executor.ts
│   ├── process-manager.ts
│   └── execution-types.ts
│
├── persistence/
│   ├── session-store.ts
│   ├── message-store.ts
│   ├── event-store.ts
│   ├── search-store.ts
│   └── sqlite-store.ts
│
├── memory/
│   ├── memory-store.ts
│   ├── memory-manager.ts
│   └── user-profile.ts
│
├── skills/
│   ├── skill-registry.ts
│   ├── skill-loader.ts
│   └── skill-manager.ts
│
├── tasks/
│   ├── task-manager.ts
│   ├── task-store.ts
│   └── task-types.ts
│
├── verification/
│   ├── verification-engine.ts
│   ├── test-discovery.ts
│   └── verification-types.ts
│
├── agents/
│   ├── subagent-runtime.ts
│   ├── delegation-manager.ts
│   └── worker-pool.ts
│
├── safety/
│   ├── policy-engine.ts
│   ├── path-policy.ts
│   ├── command-policy.ts
│   ├── network-policy.ts
│   ├── secret-policy.ts
│   ├── approval-manager.ts
│   └── path-sandbox.ts
│
├── plugins/
│   ├── plugin-runtime.ts
│   └── plugin-registry.ts
│
├── integrations/
│   ├── mcp/
│   ├── gateway/
│   └── acp/
│
├── events/
│   ├── event-bus.ts
│   └── event-types.ts
│
└── types/
```

Do not create every directory immediately. The layout is the destination, not the first commit.

---

# 7. Detailed Runtime Workflow

This should become the canonical PπBot execution flow.

```text
USER INPUT
    ↓
Interface Adapter
    ↓
Normalize AgentInput
    ↓
SessionStore.load()
    ↓
Create Turn
    ↓
ContextEngine.preflight()
    ├── load project context
    ├── load memory snapshot
    ├── resolve skills
    ├── resolve references
    ├── calculate token budget
    └── compress if necessary
    ↓
ProviderRuntime.resolve()
    ↓
Build model request
    ↓
Emit model.started
    ↓
Call provider
    ↓
Stream model events
    ↓
Parse response
    ↓
No tool calls?
    ├── YES
    │    ↓
    │  Persist assistant message
    │    ↓
    │  Emit turn.completed
    │    ↓
    │  Return final answer
    │
    └── NO
         ↓
      ToolRuntime.execute()
         ↓
      Tool schema validation
         ↓
      PolicyEngine.evaluate()
         ↓
      Approval if required
         ↓
      Execution backend / handler
         ↓
      Stream tool output
         ↓
      Persist result
         ↓
      ContextEngine.observe()
         ↓
      Task/verification state update
         ↓
      Context pressure check
         ↓
      Next iteration
```

---

# 8. Error Model

Create a normalized error hierarchy.

```ts
abstract class AgentError extends Error {
  code: string;
  retryable: boolean;
  userVisible: boolean;
}
```

Suggested error codes:

```text
PROVIDER_AUTH
PROVIDER_RATE_LIMIT
PROVIDER_TIMEOUT
PROVIDER_UNAVAILABLE
PROVIDER_INVALID_REQUEST
PROVIDER_CONTEXT_OVERFLOW
TOOL_NOT_FOUND
TOOL_INVALID_ARGUMENTS
TOOL_TIMEOUT
TOOL_CANCELLED
POLICY_DENIED
APPROVAL_DENIED
SANDBOX_VIOLATION
EXECUTION_FAILED
PROCESS_NOT_FOUND
CONTEXT_COMPRESSION_FAILED
SESSION_NOT_FOUND
PLUGIN_LOAD_FAILED
```

All lower-level errors should be normalized before being returned to the model or interface.

---

# 9. Cancellation and Interrupts

Cancellation should be first-class.

Use `AbortController` / `AbortSignal` throughout the runtime.

```text
User presses Ctrl+C
        ↓
AbortController.abort()
        ↓
ConversationLoop stops
        ↓
Provider request cancelled
        ↓
Active tool cancelled where possible
        ↓
Process manager terminates managed child processes
        ↓
Session state persisted as cancelled
```

Do not allow a blocked provider call or shell process to make the REPL unresponsive.

---

# 10. Concurrency Model

Tool calls that are independent may execute concurrently.

Example:

```text
LLM response
 ├── read_file(A)
 ├── read_file(B)
 └── git_status()
```

Can execute with a bounded worker pool.

Requirements:

- preserve original result ordering
- never run unsafe interactive commands concurrently without policy approval
- allow tools to declare `concurrency: "parallel" | "serial"`
- allow global runtime serialisation for stateful operations

---

# 11. Coding-Agent Behavior Requirements

PπBot should progressively converge on this coding workflow:

```text
1. Understand the task
2. Inspect repository structure
3. Read relevant files
4. Discover project instructions
5. Build a plan
6. Identify affected files
7. Make minimal edits
8. Inspect diff
9. Run targeted tests/checks
10. Diagnose failures
11. Fix failures
12. Re-run verification
13. Summarize changes and verification
```

The agent should not be encouraged to:

- rewrite files unnecessarily
- run destructive commands without approval
- assume a change works without verification
- dump huge irrelevant files into context
- use tool calls when a concise reasoning step is enough
- invent file contents it has not inspected

---

# 12. Tool Design Standards

Every tool should ideally define:

```ts
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  toolset: string;
  dangerous?: boolean;
  concurrency?: "parallel" | "serial";
  timeoutMs?: number;
  requiresApproval?: boolean;
}
```

Every invocation should have:

```text
validation
policy check
execution
structured result
telemetry/event
```

A model-readable error should be structured.

Example:

```json
{
  "ok": false,
  "error": {
    "code": "FILE_NOT_FOUND",
    "message": "The requested file does not exist.",
    "path": "src/auth.ts"
  }
}
```

---

# 13. Persistence Design

Recommended initial SQLite model:

```sql
sessions(
  id TEXT PRIMARY KEY,
  parent_session_id TEXT,
  cwd TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  status TEXT,
  created_at INTEGER,
  updated_at INTEGER
)

messages(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  tool_call_id TEXT,
  created_at INTEGER,
  token_estimate INTEGER,
  metadata_json TEXT
)

tool_calls(
  id TEXT PRIMARY KEY,
  session_id TEXT,
  message_id TEXT,
  name TEXT,
  arguments_json TEXT,
  status TEXT,
  started_at INTEGER,
  completed_at INTEGER
)

tool_results(
  id TEXT PRIMARY KEY,
  tool_call_id TEXT,
  ok INTEGER,
  result_json TEXT,
  created_at INTEGER
)

session_events(
  id TEXT PRIMARY KEY,
  session_id TEXT,
  type TEXT,
  payload_json TEXT,
  created_at INTEGER
)

session_lineage(
  parent_session_id TEXT,
  child_session_id TEXT
)
```

FTS5 should index message content and selected metadata.

---

# 14. Configuration Model

PπBot should eventually centralize runtime configuration.

Example:

```ts
interface AgentConfig {
  workspace: WorkspaceConfig;
  model: ModelConfig;
  context: ContextConfig;
  tools: ToolConfig;
  execution: ExecutionConfig;
  safety: SafetyConfig;
  memory: MemoryConfig;
  persistence: PersistenceConfig;
  skills: SkillConfig;
  delegation: DelegationConfig;
}
```

Configuration should be loadable from:

```text
CLI flags
environment variables
project config
user config
```

with deterministic precedence.

---

# 15. Observability

Add structured logging and metrics before the system becomes distributed.

Track:

```text
turn duration
model latency
provider failures
input tokens
output tokens
tool latency
tool failure rate
compression frequency
context size
iteration count
verification passes/failures
subagent count
```

Prefer structured JSON logs internally.

Example:

```json
{
  "event": "tool.completed",
  "sessionId": "s_123",
  "tool": "execute_command",
  "durationMs": 1240,
  "exitCode": 0
}
```

---

# 16. Testing Strategy

The architectural refactor should introduce tests by subsystem.

## Unit tests

### Context

- prompt ordering
- inheritance rules
- token budgeting
- compression preservation

### Tools

- schema validation
- dispatch
- timeout
- cancellation
- concurrency

### Safety

- path traversal rejection
- dangerous command detection
- approval behavior
- non-TTY default deny

### Providers

- adapter parsing
- streaming events
- retries
- fallback

### Persistence

- session creation
- message insertion
- search
- lineage

### Execution

- process lifecycle
- output streaming
- kill/cancel

## Integration tests

At minimum:

```text
User → agent → read_file → edit_file → test → final answer
```

```text
User → agent → dangerous command → approval denied
```

```text
User → agent → context overflow → compression → successful continuation
```

```text
User → agent → provider timeout → fallback provider
```

```text
User → agent → long-running process → inspect logs → kill process
```

---

# 17. Migration Strategy

Do NOT perform a large rewrite in one commit.

The recommended approach is incremental extraction.

---

## Phase 0 — Baseline and contracts

### Goal
Freeze the current behavior with tests before refactoring.

### Tasks

- Add tests around the current agent loop.
- Add stable types for `Message`, `ToolCall`, `ToolResult`, `AgentInput`, `AgentResult`.
- Add normalized errors.
- Add `AbortSignal` to provider/tool APIs.

### Completion criteria

- Existing MVP behavior remains unchanged.
- Public runtime types are documented.

---

# Phase 1 — Extract Agent Runtime

### Goal
Make `AgentRuntime` an orchestrator.

### Tasks

1. Extract `ConversationLoop`.
2. Extract `TurnRunner`.
3. Add `EventBus`.
4. Make REPL consume events.
5. Add cancellation.
6. Add normalized error handling.

### Target

```text
AgentRuntime
  ↓
ConversationLoop
  ↓
TurnRunner
```

### Completion criteria

- REPL has no provider-specific logic.
- Runtime can be invoked without the REPL.
- Ctrl+C cleanly cancels a turn.

---

# Phase 2 — Context Engine

### Goal
Replace static prompt construction with a real context subsystem.

### Tasks

1. Rename/extract `ContextBuilder` → `ContextEngine`.
2. Add token budgeting.
3. Add project instruction discovery.
4. Add context preservation rules.
5. Replace sliding-window-only pruning.
6. Add context compression.

### Completion criteria

- Context assembly is deterministic.
- Compression is tested.
- Tool-call/result pairs remain valid after compression.

---

# Phase 3 — Session Persistence

### Goal
Make sessions durable.

### Tasks

1. Introduce SQLite.
2. Implement `SessionStore`.
3. Implement `MessageStore`.
4. Persist tool calls/results.
5. Add FTS5 search.
6. Add session lineage.

### Completion criteria

Restarting PπBot does not lose session history.

---

# Phase 4 — Tool Runtime + Execution Runtime

### Goal
Separate what a tool wants from how the operation executes.

### Tasks

1. Keep registry for discovery.
2. Introduce `ToolRuntime`.
3. Add toolsets.
4. Extract command execution into `ExecutionRuntime`.
5. Add `ProcessManager`.
6. Stream process output.
7. Add cancellation.

### Completion criteria

`execute_command` is a thin tool adapter over the execution runtime.

---

# Phase 5 — Safety / Policy Engine

### Goal
Unify all safety decisions.

### Tasks

1. Extract command policy from `human-confirm.ts`.
2. Keep path sandbox as a policy.
3. Add approval manager.
4. Add secret protection rules.
5. Add network policy hooks.

### Completion criteria

All dangerous actions pass through one policy decision point.

---

# Phase 6 — Coding-Agent Workflow

### Goal
Make PπBot substantially better at real repository work.

### Tasks

1. Git tools.
2. Patch subsystem.
3. Checkpoints.
4. Task/todo manager.
5. Verification engine.
6. Automatic test discovery.

### Completion criteria

PπBot can:

```text
inspect → plan → edit → diff → test → fix → retest → summarize
```

without needing manual orchestration for common coding tasks.

---

# Phase 7 — Memory + Skills

### Goal
Add durable knowledge and procedural knowledge.

### Tasks

1. `MEMORY.md`.
2. `USER.md`.
3. Memory tools.
4. Skill registry.
5. Progressive skill disclosure.
6. Skill authoring support.

### Completion criteria

The agent can reuse learned project knowledge across sessions without injecting the entire historical transcript.

---

# Phase 8 — Subagents

### Goal
Enable parallel specialized work.

### Tasks

1. DelegationManager.
2. Child sessions.
3. Worker pool.
4. Isolated context.
5. Structured child summaries.
6. Parent integration.

### Completion criteria

A parent can delegate independent work and continue safely.

---

# Phase 9 — Provider Runtime Maturity

### Goal
Make model selection resilient and configurable.

### Tasks

1. Provider profiles.
2. Model capabilities.
3. Retry policy.
4. Fallback models.
5. Model routing.
6. Auxiliary model support.

### Completion criteria

A temporary provider outage does not necessarily terminate the entire task.

---

# Phase 10 — Extensibility

### Goal
Allow integrations without modifying core code.

### Tasks

1. Plugin system.
2. MCP client runtime.
3. HTTP / WebSocket interface.
4. Gateway adapters.
5. ACP integration.
6. Scheduler / cron.

### Completion criteria

External integrations can be added as modules without changing the core conversation loop.

---

# 18. Recommended Implementation Order

The shortest path to high capability is:

```text
1. AgentRuntime refactor
2. EventBus + cancellation
3. ContextEngine
4. Token budgeting
5. Context compression
6. SQLite sessions
7. Session search
8. ToolRuntime
9. ExecutionRuntime
10. ProcessManager
11. PolicyEngine
12. Git tools
13. Patch engine
14. Checkpoints
15. Verification engine
16. Task/todo manager
17. Memory
18. Skills
19. Provider retries/fallbacks
20. Subagents
21. MCP
22. Plugins
23. Gateway/API
24. Scheduler
```

Do not reverse this ordering unless a concrete product requirement demands it.

---

# 19. MVP Definition for the Next Major Version

Before calling the architecture “Hermes-class”, PπBot should be able to do the following reliably:

## Session behavior

- resume an existing session
- persist all important messages/tool events
- search prior conversation
- survive application restart

## Context behavior

- discover project instructions
- manage a token budget
- compress old context
- preserve important task state
- resolve explicit file references

## Coding behavior

- inspect repository
- plan work
- make surgical changes
- show diffs
- run tests
- diagnose failures
- iterate until verification passes or the task is blocked

## Execution behavior

- run long-lived processes
- inspect process output
- terminate processes
- enforce workspace boundaries
- request approval for dangerous operations

## Agent behavior

- use skills
- maintain tasks
- remember important project facts
- delegate independent subtasks
- recover from provider failures
- cancel cleanly

## Extensibility

- add new tools without modifying the runtime
- add new providers without modifying the conversation loop
- eventually add MCP/plugins without changing core semantics

---

# 20. Architecture Rules to Keep Permanently

These rules should become project-level design principles.

## Rule 1 — Runtime owns orchestration

Tools, providers, and interfaces should never become the main orchestration layer.

## Rule 2 — Context is a subsystem

Never grow `context-builder.ts` into a giant prompt utility.

## Rule 3 — Persistence is independent from context

Historical data and active model context are different concepts.

## Rule 4 — Security is deterministic

Never rely on model instructions as a security boundary.

## Rule 5 — Tools describe capabilities

Execution mechanics belong to tool/runtime backends.

## Rule 6 — UI consumes events

The terminal is one frontend, not the agent itself.

## Rule 7 — Providers are adapters

Provider-specific request/response formats stay behind the provider boundary.

## Rule 8 — Long tasks require state

Tasks, checkpoints, processes, verification, and session history must survive beyond a single model response.

## Rule 9 — Progressive disclosure beats giant prompts

Skills, history, and contextual artifacts should be loaded when relevant.

## Rule 10 — Prefer extraction over rewrites

When adding a new subsystem, extract responsibility from existing code rather than rebuilding unrelated functionality.

---

# 21. Hermes-Inspired Capability Mapping

| Capability | Existing PπBot | Required Change | Priority |
|---|---|---|---:|
| Agent loop | Yes | Refactor into explicit turn lifecycle | P0 |
| Streaming | Yes | Move into EventBus events | P0 |
| Tool registry | Yes | Add ToolRuntime + toolsets | P0 |
| Tool schema validation | Yes | Keep and centralize | P0 |
| Path sandbox | Yes | Integrate with PolicyEngine | P0 |
| Human approval | Yes | Extract ApprovalManager | P0 |
| Provider abstraction | Yes | Add ProviderRuntime | P0 |
| Session persistence | Partial | SQLite SessionStore | P0 |
| Session search | No | SQLite FTS5 | P0 |
| Context compression | Basic pruning | Dedicated ContextEngine | P0 |
| Token budgeting | Basic threshold | Full token budget | P0 |
| Project context files | Limited | Hierarchical loader | P1 |
| Memory | No | MEMORY.md / USER.md | P1 |
| Skills | No | Progressive-disclosure system | P1 |
| Process manager | No | Persistent process subsystem | P1 |
| Git integration | No | First-class Git tools | P1 |
| Checkpoints | No | Git/patch checkpoints | P1 |
| Verification engine | No | Test/lint/build verification | P1 |
| Task/todo | No | Persistent task manager | P1 |
| Provider retry/fallback | Limited | Runtime policy | P1 |
| Model routing | No | Capability-based routing | P2 |
| Subagents | No | Child sessions + delegation | P2 |
| Docker execution | No | Execution backend | P2 |
| Plugins | No | Plugin runtime | P2 |
| MCP | No | MCP client layer | P2 |
| Gateway | No | Transport adapters | P3 |
| ACP | No | Integration layer | P3 |
| Cron | No | Scheduler | P3 |

Priority definitions:

```text
P0 = foundational architecture
P1 = major coding-agent capability
P2 = advanced runtime capability
P3 = ecosystem/integration capability
```

---

# 22. Final Target

The end-state is not “PπBot has many features.”

The end-state is:

```text
                    PπBot
                      │
             ┌────────┴─────────┐
             │                  │
        Agent Runtime       Interface Layer
             │                  │
 ┌───────────┼───────────┐      ├── CLI
 │           │           │      ├── API
 ▼           ▼           ▼      ├── Gateway
Context     Tools      Providers └── ACP
 │           │           │
 └─────┬─────┴─────┬─────┘
       │           │
       ▼           ▼
   Persistence   Execution
       │           │
       ▼           ▼
   Memory      Workspace
       │
       ▼
    Skills
       │
       ▼
  Subagents
```

The important architectural property is **separation of concerns**.

A mature PπBot should allow you to replace:

- Gemini with another provider;
- local shell with Docker;
- CLI with a web client;
- built-in tools with plugin tools;
- default context compression with another context engine;
- local memory with an external memory provider;
- one agent with multiple subagents;

without changing the fundamental conversation loop.

That is the architectural milestone that moves PπBot from an MVP coding-agent project toward a production-grade general agent runtime.

---

# 23. Immediate Next Steps for the Repository

Implement these first, in this exact order:

```text
[ ] Add stable core domain types
[ ] Extract ConversationLoop from AgentRuntime
[ ] Add EventBus
[ ] Add AbortSignal/cancellation end-to-end
[ ] Extract ContextEngine
[ ] Add TokenBudget
[ ] Add ContextCompressor
[ ] Add hierarchical project context loading
[ ] Add SQLite SessionStore
[ ] Persist messages/tool results
[ ] Add FTS5 session search
[ ] Extract ToolRuntime from ToolRegistry
[ ] Introduce ExecutionRuntime
[ ] Introduce ProcessManager
[ ] Introduce PolicyEngine
[ ] Add Git tools
[ ] Add patch/checkpoint subsystem
[ ] Add VerificationEngine
[ ] Add TaskManager
[ ] Add MEMORY.md / USER.md
[ ] Add Skills
[ ] Add ProviderRuntime + fallback
[ ] Add SubagentRuntime
[ ] Add MCP
[ ] Add PluginRuntime
[ ] Add API/Gateway/ACP
[ ] Add Scheduler
```

Do not treat the checklist as a requirement to implement all features before shipping. Each completed phase should leave PπBot usable.

---

# 24. Definition of Architectural Success

PπBot has successfully evolved when the following statements are true:

### Agent core

> `AgentRuntime` can execute a task without knowing whether the caller is the CLI, HTTP API, gateway, or scheduler.

### Context

> Context assembly and compression can change independently of the conversation loop.

### Tools

> A new tool can be added without modifying the agent runtime.

### Providers

> A new provider can be added without modifying tool or context code.

### Execution

> Terminal execution can switch from local to Docker without changing the terminal tool contract.

### Persistence

> The user can stop PπBot, restart it, and continue an existing task/session.

### Safety

> Every dangerous side effect is evaluated by deterministic runtime policy before execution.

### Coding quality

> PπBot verifies its code changes instead of stopping after file modification.

### Scale

> A large task can use compression, persistent state, process management, and subagents without turning the main context into an unmanageable transcript.

### Extensibility

> New capabilities can be introduced through plugins/skills/MCP rather than core rewrites.

---

# 25. Reference Architecture Principle

The guiding mental model for PπBot should be:

```text
LLM decides WHAT to attempt.

Runtime decides WHETHER it is allowed.

ToolRuntime decides HOW the capability is invoked.

ExecutionRuntime decides WHERE it runs.

ContextEngine decides WHAT the model needs to know.

SessionStore decides WHAT history exists.

Verification decides WHETHER the change actually works.

EventBus decides HOW the outside world observes the runtime.
```

This separation is the foundation for making PπBot substantially more capable without making the codebase disproportionately more fragile.

---

# Appendix A — Suggested Initial Interfaces

## Agent

```ts
interface AgentInput {
  sessionId?: string;
  message: string;
  cwd: string;
  signal?: AbortSignal;
}

interface AgentResult {
  sessionId: string;
  status: "completed" | "failed" | "cancelled" | "max_iterations";
  message?: string;
}
```

## Context

```ts
interface ContextEngine {
  build(input: ContextBuildInput): Promise<ModelContext>;
  shouldCompress(context: ModelContext): boolean;
  compress(context: ModelContext): Promise<ModelContext>;
}
```

## Tools

```ts
interface ToolRuntime {
  execute(
    calls: ToolCall[],
    context: ToolExecutionContext,
  ): Promise<ToolResult[]>;
}
```

## Providers

```ts
interface ProviderRuntime {
  resolve(request: ModelRequest): Promise<ResolvedProvider>;
}
```

## Persistence

```ts
interface SessionStore {
  create(input: CreateSessionInput): Promise<Session>;
  get(id: string): Promise<Session | null>;
  appendMessage(sessionId: string, message: Message): Promise<void>;
  listMessages(sessionId: string): Promise<Message[]>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}
```

## Execution

```ts
interface ExecutionRuntime {
  execute(
    command: string,
    options: ExecutionOptions,
  ): Promise<ExecutionResult>;
}
```

## Safety

```ts
interface PolicyEngine {
  evaluate(action: AgentAction): Promise<PolicyDecision>;
}
```

## Memory

```ts
interface MemoryStore {
  read(scope: string): Promise<string>;
  write(scope: string, content: string): Promise<void>;
  search(query: string): Promise<MemoryResult[]>;
}
```

## Skills

```ts
interface SkillRegistry {
  list(): Promise<SkillSummary[]>;
  load(name: string): Promise<SkillDocument>;
}
```

## Plugins

```ts
interface PibotPlugin {
  name: string;
  register(context: PluginContext): void | Promise<void>;
}
```

---

# Appendix B — Practical “Do This First” Refactor

The first refactor should be small enough to merge safely.

### Before

```text
AgentRuntime
 ├── build prompt
 ├── call provider
 ├── parse response
 ├── execute tools
 ├── update conversation
 └── print/stream output
```

### After

```text
AgentRuntime
 └── ConversationLoop
      ├── ContextEngine
      ├── ProviderRuntime
      ├── ToolRuntime
      ├── SessionStore
      └── EventBus
```

The code should then read approximately like:

```ts
const session = await sessions.loadOrCreate(input);

const result = await conversationLoop.run({
  session,
  input,
  signal,
});

return result;
```

Everything else should be delegated to explicit subsystems.

---

# Appendix C — Golden Test Scenario

Use this as the canonical end-to-end regression test after each major refactor.

User task:

```text
Add a health endpoint to the existing server, update the tests, run the test suite, and fix any failures.
```

Expected agent behavior:

```text
1. Load session
2. Discover project instructions
3. Inspect repository
4. Identify server implementation
5. Inspect existing tests
6. Plan changes
7. Edit server
8. Edit/add tests
9. Show diff
10. Run targeted tests
11. Observe failure if any
12. Fix failure
13. Run full test suite
14. Report files changed
15. Report verification result
```

This single scenario exercises:

```text
session
context
planning
tools
patching
execution
process management
verification
error recovery
persistence
final response
```

It should remain a permanent regression test for the agent architecture.

---

**Document status:** Architecture roadmap / implementation specification

**Primary objective:** Evolve PπBot into a modular, persistent, extensible coding-agent runtime without abandoning the existing TypeScript codebase or introducing an agent framework dependency.
