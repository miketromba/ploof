<p align="center">
  <img src="assets/brand/ploof-banner.png" alt="Ploof - AI asset generation from the command line." width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@miketromba/ploof"><img src="https://img.shields.io/npm/v/@miketromba/ploof" alt="npm version" /></a>
  <a href="https://github.com/miketromba/ploof/actions/workflows/ci.yml"><img src="https://github.com/miketromba/ploof/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/miketromba/ploof/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@miketromba/ploof" alt="license" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node version" />
</p>

Ploof is a CLI for generating and editing creative assets with AI providers. It supports OpenAI image, video, and audio generation/processing today, plus the legacy OpenAI image variations endpoint when the authenticated project has access. The provider registry is designed for broader model marketplaces over time.

It is built for both developers and AI agents: predictable commands, parseable output, local auth profiles, YAML manifests, parallel execution, and a companion skill.

## Supported Today

| Area | Status |
| --- | --- |
| OpenAI auth profiles | Supported |
| OpenAI image generation | Supported |
| OpenAI image editing | Supported |
| OpenAI image variations | Legacy endpoint; supported when available to the authenticated project |
| OpenAI video generation | Supported |
| OpenAI video editing/extensions | Supported |
| OpenAI video downloads/library/characters | Supported |
| OpenAI audio generation / TTS | Supported |
| OpenAI audio transcription | Supported |
| OpenAI audio translation | Supported |
| Context images and masks | Supported |
| Image, video, and audio input assets | Supported |
| YAML/JSON batch manifests | Supported |
| Dependency-aware parallel runs | Supported |
| Agent instructions via `ploof learn` | Supported |
| Additional providers | Planned |

## Install

```bash
bun i -g @miketromba/ploof
```

Other package managers:

```bash
npm install -g @miketromba/ploof
pnpm add -g @miketromba/ploof
yarn global add @miketromba/ploof
```

Run without installing:

```bash
bunx @miketromba/ploof --help
npx @miketromba/ploof --help
```

## Quick Start

```bash
# Authenticate
ploof login openai --api-key <your-api-key>

# Generate an image
ploof image generate \
  --prompt "Studio product photo of a matte black water bottle" \
  --out assets/hero.png \
  --size 1024x1024

# Edit an image with context
ploof image edit \
  --image assets/input.png \
  --mask assets/mask.png \
  --prompt "Replace the background with a clean marble countertop" \
  --out assets/edited.png

# Generate and download a video
ploof video generate \
  --prompt "Wide tracking shot of a paper city at blue hour" \
  --model sora-2 \
  --size 1280x720 \
  --seconds 4 \
  --out assets/clip.mp4

# Generate and transcribe speech
ploof audio generate \
  --text "Ploof can generate speech and process audio." \
  --voice alloy \
  --out assets/speech.mp3

ploof audio transcribe \
  --audio assets/speech.mp3 \
  --out assets/transcript.json

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

OpenAI image generation and editing default to `gpt-image-2` when `--model` is omitted.

```bash
ploof image generate \
  --provider openai \
  --profile default \
  --prompt "Editorial portrait, dramatic side light" \
  --out assets/portrait.png \
  --model gpt-image-2 \
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

## Image Variations

OpenAI image variations use the legacy variations endpoint and default to `dall-e-2`, which is currently the only supported model for that endpoint. If OpenAI returns a 404 for this command, use `ploof image edit` for image-to-image workflows or try a profile/project with DALL-E 2 variation access.

```bash
ploof image variation \
  --provider openai \
  --image input.png \
  --out variation.png \
  --size 1024x1024
```

The plural alias also works:

```bash
ploof image variations --image input.png --out variation.png
```

## Video Generation

OpenAI video generation uses the asynchronous Videos API. `ploof video generate` submits a job immediately. If you pass `--out` or `--download`, Ploof waits for completion and downloads the requested asset.

```bash
ploof video generate \
  --provider openai \
  --prompt "Wide tracking shot of a teal coupe on a desert highway" \
  --model sora-2 \
  --size 1280x720 \
  --seconds 4 \
  --out assets/clip.mp4 \
  --output json
```

Useful generation flags:

| Flag | Description |
| --- | --- |
| `--model <model>` | Video model, for example `sora-2` or `sora-2-pro` |
| `--size <size>` | Output resolution, for example `1280x720` |
| `--seconds <seconds>` | Clip or extension duration |
| `--input-reference <path-or-url-or-file-id>` | Image reference for the first frame |
| `--input-reference-file-id <id>` | OpenAI uploaded image file id |
| `--input-reference-url <url>` | Image URL or data URL reference |
| `--character <id>` | Reusable character id; repeat for multiple characters |
| `--wait` | Poll until the job reaches a terminal status |
| `--download` | Download after waiting |
| `--variant <variant>` | `video`, `thumbnail`, or `spritesheet` |
| `--poll-interval <seconds>` | Polling interval while waiting |
| `--timeout <seconds>` | Maximum wait time |
| `--param key=value` | Provider-specific pass-through parameter |
| `--json '{...}'` | Provider-specific JSON object |

If you omit `--model`, Ploof defaults OpenAI video generation to `sora-2`.

## Video Editing And Library

```bash
ploof video edit \
  --video-id video_abc123 \
  --prompt "Shift the palette to teal and rust" \
  --out assets/edit.mp4

ploof video extend \
  --video-id video_abc123 \
  --prompt "Continue as the camera rises over the rooftops" \
  --seconds 4 \
  --out assets/extended.mp4

ploof video download video_abc123 --variant thumbnail --out assets/thumb.webp
ploof video status video_abc123 --output json
ploof video list --limit 20 --output json
ploof video delete video_abc123
```

OpenAI video edits accept either `--video-id <id>` for an existing completed OpenAI video or `--video <path>` for an uploaded source video when the authenticated project is eligible for that workflow. Extensions accept a source video id or upload, plus a prompt and `--seconds`.

Reusable character commands:

```bash
ploof video character create --name Mossy --video character.mp4 --output json
ploof video character get char_abc123 --output json
```

## Audio Generation And Processing

OpenAI audio generation defaults to `gpt-4o-mini-tts`, `alloy`, and `mp3` when model, voice, and format are omitted.

```bash
ploof audio generate \
  --provider openai \
  --text "A concise product narration for the demo reel." \
  --model gpt-4o-mini-tts \
  --voice alloy \
  --format mp3 \
  --out assets/narration.mp3 \
  --output json
```

Useful generation flags:

| Flag | Description |
| --- | --- |
| `--model <model>` | TTS model, for example `gpt-4o-mini-tts` |
| `--voice <voice>` | Built-in voice such as `alloy`, `coral`, `nova`, or `shimmer` |
| `--voice-id <id>` | Custom voice id |
| `--instructions <text>` | Voice/style instructions for supported models |
| `--format <format>` | `mp3`, `opus`, `aac`, `flac`, `wav`, or `pcm` |
| `--speed <number>` | Speech speed |
| `--param key=value` | Provider-specific pass-through parameter |
| `--json '{...}'` | Provider-specific JSON object |

Transcription and translation:

```bash
ploof audio transcribe \
  --audio assets/narration.mp3 \
  --model gpt-4o-mini-transcribe \
  --out assets/transcript.json \
  --output json

ploof audio translate \
  --audio assets/spanish.mp3 \
  --model whisper-1 \
  --format text \
  --out assets/translation.txt \
  --output json
```

Transcription supports `--language`, `--prompt`, `--format`, `--temperature`, `--include`, `--timestamp-granularity`, `--chunking-strategy`, `--known-speaker-name`, and `--known-speaker-reference`. Translation supports `--prompt`, `--format`, and `--temperature`.

Ploof writes complete static assets to disk. Streaming transport settings such as OpenAI `stream=true` for transcription or `stream_format=sse` for speech are rejected because they do not produce a finished asset file directly.

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
      model: gpt-image-2
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

  - id: variation
    kind: image.variation
    provider: openai
    needs: [base]
    inputs:
      images:
        - task: base
    output: assets/variation.png

  - id: clip
    kind: video.generate
    provider: openai
    prompt: "Slow dolly shot through a miniature paper city"
    params:
      model: sora-2
      size: 1280x720
      seconds: "4"
    wait: true
    download: true
    output: assets/clip.mp4

  - id: narration
    kind: audio.generate
    provider: openai
    text: "Short narration for the generated clip."
    params:
      model: gpt-4o-mini-tts
      voice: alloy
      response_format: mp3
    output: assets/narration.mp3

  - id: transcript
    kind: audio.transcribe
    provider: openai
    needs: [narration]
    inputs:
      audio:
        task: narration
    params:
      model: gpt-4o-mini-transcribe
    output: assets/transcript.json
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

The default test suite includes mocked OpenAI end-to-end tests. Those tests run real `ploof` CLI commands against a local mock OpenAI server and verify generated files, edit uploads, video job polling/downloads, audio generation/processing, sidecar metadata, and dependency-aware manifests without spending API credits.

Live OpenAI tests are opt-in only:

```bash
PLOOF_OPENAI_API_KEY=sk-... bun test tests/e2e
```

Optional live-test overrides:

```bash
PLOOF_OPENAI_LIVE_MODEL=gpt-image-2
PLOOF_OPENAI_LIVE_SIZE=1024x1024
```

## Publishing

Local release verification stops at packaging:

```bash
bun run release
```

Publishing should happen from GitHub Actions by pushing a `v*` tag. The npm
package must have a Trusted Publisher configured with:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `miketromba` |
| Repository | `ploof` |
| Workflow filename | `publish.yml` |
| Environment | blank |
| Allowed action | `npm publish` |

Do not publish from a local terminal unless intentionally doing a manual
emergency release.

## License

MIT
