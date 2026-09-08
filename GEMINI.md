# PlainScript Language Intent & Execution Guidelines

## 1. Communication & Response Protocol
- **Short & Precise Responses**: For backlogging, status updates, or questions not requiring extensive architectural reasoning, deliver short, exact, high-density answers.
- **Zero Conversational Fluff**: Omit pleasantries, preamble, repetitive summarization, and filler. Focus on exact deltas, verification metrics, and actionable checkpoints.

## 2. Working Task Sheet Discipline (`TASKS.md`)
- **Punch List Workflow**: Maintain `TASKS.md` as a living, human-written punch list representing project roadmap phases.
- **Immediate Deletion on Completion**: As soon as a phase or deliverable is completed and fully verified, remove it from `TASKS.md`.
- **Strictly Untracked**: Never commit or push `TASKS.md` (or `tasks.md`), nor large generated datasets (`dataset/`, `*.jsonl`), to git.

## 3. Engineering & Compiler Rigor
- **Silent Proactive Execution**: Autonomously implement and test non-destructive changes without asking permission for obvious roadmap steps.
- **100% Green Test Suite**: Every existing and new test suite across the repository must remain 100% passing (`npm test` exit code 0) on every step.
- **No Hallucinated Syntax**: All compiler features must be backed by formal AST nodes, lexer tokens, code generation, and automated regression suites.
- **Sound Compile-Time Type Inference**: Provide compile-time type inference and error guarantees without imposing mandatory type annotation noise on the developer.
- **Deterministic Code Generation**: Intent-oriented constructs must map deterministically to clean, predictable execution targets (Node.js, ES Modules, WebAssembly).

## 4. Language Architecture: Intent-Oriented Programming (IOPL)
- **Intent-Oriented Paradigm**: PlainScript programs express direct computational intent using natural, unambiguous English constructs (`remember`, `show`, `if ... otherwise ... done`, `make / give`, `repeat ... done`, `route get`, `database`).
- **Pure `.pln` Identity**: Focus strictly on `.pln` source programs. Never define, describe, or frame PlainScript through legacy comparisons or external scripting tropes.
- **Token Density & Ergonomics**: Prioritize high token density and zero syntax noise (no curly braces, semicolons, or indentation sensitivity) to optimize readability for humans and token efficiency for AI generation.
- **100% Compiler-Verified AI Datasets**: Any fine-tuning corpus generated for LLM training must pass through a strict compiler validation gate (0 syntax errors).

## 5. Anti-Divergence Guardrails & Mandatory Warning System
- **RULE 1: Zero AI Gimmicks in Compiler**: PlainScript is an authentic, production-grade programming language compiler. Never inject fake AI prompt synthesizers, LLM wrappers, or conversational chatbot loops into the compiler core binary. PlainScript is the *target language* that AI models generate with high token efficiency, not an LLM wrapper.
- **RULE 2: Core Language Purity Over Grammar Bloat**: Proprietary messaging platforms and domain-specific APIs (Telegram, WhatsApp, OCR) belong in modular external packages (`@plainscript/*`), never hardcoded into core grammar tokens.
- **RULE 3: Proactive Divergence Warning**: If any user request, proposed task, or architectural direction threatens to divert from the intent-oriented programming model (e.g., adding prompt wrappers, external runtime bloat, or non-IOPL primitives into the core compiler), the assistant **MUST IMMEDIATELY WARN** the user of the architectural divergence before writing code.

## 6. Visual Brand Invariant
- **Visual Identity & Logo**: The official PlainScript logo is a stark green box with "PLN" written in uppercase bold text (`#00E575` / green-on-dark).


