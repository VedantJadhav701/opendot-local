# Contributing to OpenDot-local

Thank you for contributing to OpenDot-local! OpenDot-local is a locally-running, privacy-first AI agent designed for developer machines.

## Development Guidelines

1. **Local-first & Privacy-first**: All core execution, prompts, file access, and LLM calls run locally on your machine via Ollama. Do not add external network calls to telemetry or remote LLM APIs without user opt-in.
2. **Safety checks**: Never weaken security invariants:
   - Host & origin validation in `src/proxy.ts` (DNS rebinding / LAN protection).
   - URL safety validation in `src/server/agent/url-safety.ts`.
   - Command denial lists and human-in-the-loop approval cards.
3. **Quality Gates**:
   Before submitting a Pull Request, verify that:
   ```bash
   pnpm run check
   ```
   runs with zero TypeScript errors, passes all unit tests, and builds successfully.

## Submitting Pull Requests

- Keep PRs focused on a single feature, bug fix, or phase.
- Ensure your git commits use your verified email address.
- Include unit tests for new functionality where applicable.
