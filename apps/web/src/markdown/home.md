# Ploof — generate images, video & audio from your terminal

> The agent-native CLI for AI asset generation. Hand it to your coding agent (Claude Code, Cursor, Codex) and it installs Ploof, reads `ploof learn`, and creates your assets. Powered by OpenAI and fal.ai.

## Get started with your agent

This is the primary path. Paste this prompt into your coding agent:

```text
{{AGENT_PROMPT}}
```

## Or install and use it yourself

```bash
bun i -g @miketromba/ploof
ploof login openai --api-key sk-...
ploof image generate --prompt "Studio product photo of a matte black bottle" --out hero.png
```

## What it does

- **Images** — generate, edit, and create variations (OpenAI `gpt-image-2`)
- **Video** — generate, edit, and extend (OpenAI `sora-2`)
- **Audio** — text-to-speech, transcription, and translation
- **Any model** — run fal.ai's marketplace endpoints via `ploof model run`
- **Batch** — declare many assets in a YAML manifest and run them in parallel
- **Agent-native** — `ploof learn` self-documents the installed version; clean JSON/JSONL output and predictable exit codes

## Links

- Documentation: https://ploof.sh/docs (Markdown: https://ploof.sh/docs.md)
- llms.txt: https://ploof.sh/llms.txt
- npm: https://www.npmjs.com/package/@miketromba/ploof
- GitHub: https://github.com/miketromba/ploof
