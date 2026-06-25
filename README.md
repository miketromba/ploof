<p align="center">
  <strong>Ploof</strong>
</p>

<p align="center">
  AI asset generation from the command line.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ploof"><img src="https://img.shields.io/npm/v/ploof" alt="npm version" /></a>
  <a href="https://github.com/miketromba/ploof/actions/workflows/ci.yml"><img src="https://github.com/miketromba/ploof/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/miketromba/ploof/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/ploof" alt="license" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node version" />
</p>

Ploof is a CLI for generating and editing creative assets with AI providers. It supports OpenAI image generation and editing today, with a provider registry designed for audio, video, and broader model marketplaces over time.

It is built for both developers and AI agents: predictable commands, parseable output, local auth profiles, YAML manifests, parallel execution, and a companion skill.

## Supported Today

| Area | Status |
| --- | --- |
| OpenAI auth profiles | Supported |
| OpenAI image generation | Supported |
| OpenAI image editing | Supported |
| Context images and masks | Supported |
| YAML/JSON batch manifests | Supported |
| Dependency-aware parallel runs | Supported |
| Agent instructions via `ploof learn` | Supported |
| Additional providers | Planned |
| Audio/video generation | Planned |

## Install

```bash
npm install -g ploof
```

Other package managers:

```bash
pnpm add -g ploof
yarn global add ploof
bun install -g ploof
```

Run without installing:

```bash
npx ploof --help
```

## Quick Start

```bash
# Authenticate
ploof login openai --api-key <your-api-key>

# Generate an image
ploof image generate \
  --prompt "Studio product photo of a matte black water bottle" \
  --out assets/hero.png \
  --model gpt-image-1 \
  --size 1024x1024

# Edit an image with context
ploof image edit \
  --image assets/input.png \
  --mask assets/mask.png \
  --prompt "Replace the background with a clean marble countertop" \
  --out assets/edited.png

# Run a manifest
ploof run assets.yaml --parallel 4
```

## Authentication

Credentials are stored locally in `~/.ploof/credentials.json`.

```bash
ploof login openai --api-key <your-api-key>
ploof login openai --api-key <your-api-key> --profile work
ploof whoami openai
ploof profiles openai
ploof logout openai --profile work
```

If `--api-key` is omitted, `ploof login openai` reads
`PLOOF_OPENAI_API_KEY` or `OPENAI_API_KEY`; in an interactive terminal it will
prompt for a key without echoing it.

Environment variables override stored credentials:

```bash
export PLOOF_OPENAI_API_KEY=sk-...
# or
export OPENAI_API_KEY=sk-...
```

OpenAI profile metadata:

```bash
ploof login openai \
  --api-key <key> \
  --organization <org-id> \
  --project <project-id> \
  --base-url <url>
```

## Image Generation

```bash
ploof image generate \
  --provider openai \
  --profile default \
  --prompt "Editorial portrait, dramatic side light" \
  --out assets/portrait.png \
  --model gpt-image-1 \
  --size 1024x1024 \
  --quality high \
  --format png
```

Useful flags:

| Flag | Description |
| --- | --- |
| `--model <model>` | Provider model |
| `--size <size>` | Image size |
| `--quality <quality>` | Image quality |
| `--format <format>` | Output image format |
| `--n <count>` | Number of images |
| `--background <value>` | Background setting |
| `--moderation <value>` | Moderation setting |
| `--response-format <format>` | Provider response format |
| `--stream` | Request streaming image events |
| `--param key=value` | Provider-specific pass-through parameter |
| `--json '{...}'` | Provider-specific JSON object |

## Image Editing

```bash
ploof image edit \
  --provider openai \
  --image input.png \
  --image reference.png \
  --mask mask.png \
  --prompt "Keep the product, replace the background" \
  --out edited.png
```

Use repeated `--image` flags for context/reference images. Use `--mask` when the selected provider/model supports masked edits.

## Batch Manifests

```yaml
version: 1
parallel: 4
tasks:
  - id: base
    kind: image.generate
    provider: openai
    prompt: "Studio product photo"
    params:
      model: gpt-image-1
      size: 1024x1024
      quality: high
    output: assets/base.png

  - id: edit
    kind: image.edit
    provider: openai
    needs: [base]
    inputs:
      images:
        - task: base
      mask: ./mask.png
    prompt: "Add a premium background"
    output: assets/final.png
```

Run it:

```bash
ploof run assets.yaml --parallel 4
ploof run assets.yaml --dry-run --output json
```

## Output Formats

Ploof defaults to table output in TTYs and compact output when piped.

```bash
ploof image generate --prompt "..." --output json
ploof run assets.yaml --output jsonl
ploof run assets.yaml --fields id,kind,outputs
```

Formats:

| Format | Use case |
| --- | --- |
| `table` | Human-readable terminal output |
| `compact` | Agent-friendly compact text |
| `json` | Programmatic consumption |
| `jsonl` | Streaming/pipeline consumption |

## AI Agent Usage

`ploof learn` is the canonical AI-agent reference for the installed CLI version:

```bash
ploof learn
```

Install the bootstrap skill:

```bash
ploof skill install
```

The skill is intentionally small and points agents to `ploof learn`, so operational instructions stay aligned with the installed npm package.

## Configuration

```bash
ploof config list
ploof config get output
ploof config set output compact
ploof config reset
```

Config is stored at `~/.ploof/config.json`.

## Development

```bash
bun install
bun run dev -- --help
bun test
bun run typecheck
bun run lint
bun run build
```

## Testing

Run the full offline gate:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
npm pack --dry-run
```

The default test suite includes mocked OpenAI end-to-end tests. Those tests run real `ploof` CLI commands against a local mock OpenAI server and verify generated files, edit uploads, sidecar metadata, and dependency-aware manifests without spending API credits.

Live OpenAI tests are opt-in only:

```bash
PLOOF_OPENAI_API_KEY=sk-... bun test tests/e2e
```

Optional live-test overrides:

```bash
PLOOF_OPENAI_LIVE_MODEL=gpt-image-1
PLOOF_OPENAI_LIVE_SIZE=1024x1024
```

## License

MIT
