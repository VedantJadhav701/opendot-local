# OpenDot Packs

Dot Packs (`.opendot.json`) are shareable, portable definitions for OpenDot personalities, skills, routines, and safety rules.

## What is in a Pack?

A Dot Pack contains:
- **Dot Identity**: Name, purpose, custom instructions, and visual appearance.
- **Skills**: Reusable capabilities and playbooks.
- **Routines**: Scheduled automation prompts (always imported in a disabled state for safety).
- **Rules**: Explicit security boundaries. Note: packs may **only** specify `"ask"` or `"never"` rules—never `"allow"`.
- **MCP Suggestions**: Suggested MCP connector presets (e.g. `github`, `filesystem`), without credentials.

### What is NEVER in a Pack?
- Conversations / chat history
- Private memories or learnings
- Logins, tokens, or credential secrets
- Unchecked `"allow"` permissions

## Schema Format

```json
{
  "format": "opendot.pack",
  "version": 1,
  "name": "Pack Title",
  "description": "Short description of what this pack does.",
  "author": "Your Name or Handle",
  "dot": {
    "name": "Dot Name",
    "purpose": "Primary purpose...",
    "instructions": "System instructions...",
    "look": { "color": "cyan" }
  },
  "skills": [
    {
      "name": "skill-name",
      "description": "What it does",
      "body": "Instructions for this skill..."
    }
  ],
  "routines": [
    {
      "name": "Routine Name",
      "instruction": "Prompt to run on schedule...",
      "schedule": "0 9 * * *"
    }
  ],
  "rules": [
    { "action": "Take action...", "decision": "ask" },
    { "action": "Dangerous action...", "decision": "never" }
  ],
  "mcp": ["github"],
  "modelHint": "qwen3:4b-instruct-2507-q4_K_M"
}
```

## Contributing a Pack via PR

1. Create a `.opendot.json` file in this `packs/` directory.
2. Keep the file size under 256 KB.
3. Verify that your pack only includes `"ask"` or `"never"` rules.
4. Ensure no private tokens, URLs with secret parameters, or personal data are included.
5. Test your pack by running `pnpm test` (or importing it in OpenDot via **Setup -> Import pack…**).
6. Submit a Pull Request to the OpenDot repository!
