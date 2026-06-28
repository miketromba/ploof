# Ploof CLI Specification

## Summary

Ploof is an npm-published CLI for generating, editing, and processing assets through AI generation providers. It supports OpenAI image, video, and audio generation/processing plus fal.ai model endpoints, while preserving an architecture for multiple authenticated providers, multiple asset modalities, provider-specific settings, and parallel execution across mixed jobs.

The product should feel like a small, sharp developer tool: easy to run manually, predictable in scripts, and optimized for AI agents.

## Naming

- NPM package: `@miketromba/ploof`
- CLI binary: `ploof`
- Brand/site target: `ploof.sh`
- Config directory: `~/.ploof`
- Environment prefix: `PLOOF_`
- Canonical agent reference command: `ploof learn`
- Bootstrap skill: `skills/asset-generation/SKILL.md`

Example:

```bash
bun i -g @miketromba/ploof
ploof login openai --api-key "$OPENAI_API_KEY"
ploof image generate --prompt "Studio product photo" --out assets/hero.png
ploof learn
```

The unscoped npm name `ploof` was rejected by npm's similarity policy during
publish because it is too close to `plop`. The canonical install package is
therefore scoped, while the command remains the short `ploof` binary.

## Prior Art And Conventions

Ploof should follow the style and publishing conventions from existing CLI projects:

- `loops-cli`
- `polar-cli`
- `lemonsqueezy-cli`
- `issy`

Conventions to preserve:

- Bun-first TypeScript development.
- `type: "module"`.
- `commander` for CLI parsing.
- `chalk` for terminal output where useful.
- Biome for lint/format.
- `bun test`, `bunx tsc --noEmit`, `bun run build`.
- `bin/ploof.ts` development entrypoint.
- `scripts/build.ts` bundles to `dist/ploof.js`.
- Published package runs on Node 18+ and does not require Bun.
- Published files are constrained to runtime artifacts, README, LICENSE, spec, and skill files.
- GitHub Actions CI runs typecheck, tests, and build.
- GitHub Actions publish runs on `v*` tags through npm trusted publishing/OIDC.
- Human-readable output in TTY, compact output when piped, JSON/JSONL for agents and scripts.

NPM trusted publisher settings for `@miketromba/ploof`:

- Provider: GitHub Actions.
- Organization or user: `miketromba`.
- Repository: `ploof`.
- Workflow filename: `publish.yml`.
- Environment: blank.
- Allowed action: `npm publish`.

Local release verification must stop at `npm pack --dry-run`; do not run local
`npm publish` for normal releases.

## Core Goals

1. Authenticate with multiple asset generation providers.
2. Allow multiple profiles per provider.
3. Generate and edit assets with provider-specific settings.
4. Accept input assets as context for provider APIs that support them.
5. Run multiple generation jobs in parallel.
6. Support dependency-aware batch manifests.
7. Preserve provider-specific settings without requiring constant CLI redesign.
8. Provide first-class AI agent support through `ploof learn` and an installable skill.
9. Publish cleanly to npm with the short `ploof` binary.

## Initial Provider Scope

The current provider scope includes OpenAI and fal.ai.

Core operation kinds:

- `model.run`
- `image.generate`
- `image.edit`
- `image.variation`
- `video.generate`
- `video.edit`
- `video.extend`
- `video.remix`
- `video.status`
- `video.download`
- `video.list`
- `video.delete`
- `video.character.create`
- `video.character.get`
- `audio.generate`
- `audio.transcribe`
- `audio.translate`

Future providers should be added through the provider registry without changing the manifest model.

Provider notes:

- OpenAI has first-class implementations for images, videos, audio/TTS, transcription, translation, and OpenAI video library operations.
- fal.ai uses the official `@fal-ai/client`, supports arbitrary endpoints through `model.run`, and supports image/video/audio commands when the chosen fal endpoint schema matches the command shape.

Future high-leverage provider candidates:

- Replicate: broad community model marketplace.
- Hugging Face Inference Providers: centralized access to many hosted models/providers.

## Auth And Profiles

Credentials are stored in a local CLI-specific directory, matching prior CLI conventions:

```text
~/.ploof/config.json
~/.ploof/credentials.json
```

Credential file shape:

```json
{
  "providers": {
    "openai": {
      "profiles": {
        "default": {
          "apiKey": "sk-..."
        }
      },
      "defaultProfile": "default"
    }
  }
}
```

Environment overrides:

- `PLOOF_OPENAI_API_KEY`
- `OPENAI_API_KEY`
- `PLOOF_FAL_KEY`
- `FAL_KEY`
- `PLOOF_FAL_KEY_ID` and `PLOOF_FAL_KEY_SECRET`
- `FAL_KEY_ID` and `FAL_KEY_SECRET`

The Ploof-specific env var wins over the provider-native env var. Stored credentials are used only when no env override is present. Split fal.ai key id/secret pairs are joined into the token format expected by the fal client.

OpenAI profile metadata may also include:

- `organization`
- `project`
- `baseURL`

## CLI Commands

### Global Flags

```bash
-o, --output <format>   table|compact|json|jsonl
-f, --fields <list>     Comma-separated field selection
-d, --detail            Include full details
--no-color              Disable color
--verbose               Debug output to stderr
-q, --quiet             Data only, minimal extra text
-y, --yes               Skip confirmation prompts
```

### Auth

```bash
ploof login openai --api-key <key> [--profile default] [--organization org] [--project proj] [--base-url url]
ploof login fal --api-key <key> [--profile default]
ploof whoami [provider] [--profile default]
ploof profiles [provider]
ploof logout <provider> [--profile default]
```

`login`, `whoami`, `profiles`, and `logout` are the only authentication
commands. Ploof should not expose a second equivalent auth namespace.

`ploof login openai` accepts `--api-key`, reads `PLOOF_OPENAI_API_KEY` or
`OPENAI_API_KEY` when the flag is omitted, and prompts without echoing input
when run in an interactive terminal. Non-interactive login fails if no key is
provided.

`ploof login fal` accepts `--api-key`, reads `PLOOF_FAL_KEY` or `FAL_KEY`, and
also supports `PLOOF_FAL_KEY_ID`/`PLOOF_FAL_KEY_SECRET` or
`FAL_KEY_ID`/`FAL_KEY_SECRET` pairs.

### Config

```bash
ploof config list
ploof config get output
ploof config set output compact
ploof config reset
```

### Image Generation

OpenAI image generation and editing default to `gpt-image-2` when no model is specified.

```bash
ploof image generate \
  --provider openai \
  --profile default \
  --prompt "Studio product photo" \
  --out assets/hero.png \
  --model gpt-image-2 \
  --size 1024x1024 \
  --quality high \
  --format png
```

The command should expose common OpenAI image parameters as first-class flags and allow pass-through parameters:

```bash
--param key=value
--json '{"providerSpecific": true}'
```

### Image Editing

```bash
ploof image edit \
  --provider openai \
  --image input.png \
  --image reference.png \
  --mask mask.png \
  --prompt "Replace the background" \
  --out assets/edited.png
```

The CLI must support multiple context images where the provider supports them.

### Image Variations

```bash
ploof image variation \
  --provider openai \
  --image input.png \
  --out assets/variation.png \
  --model dall-e-2 \
  --size 1024x1024
```

OpenAI variations default to `dall-e-2`, because the legacy OpenAI variations
endpoint only supports that model. This endpoint is supported when the
authenticated project has DALL-E 2 variation access; if OpenAI returns a 404,
use `ploof image edit` for image-to-image workflows. `ploof image variations`
is an alias.

### Generic Model Endpoints

`model.run` executes arbitrary provider model endpoints. It is primarily useful
for model marketplaces such as fal.ai, where the endpoint schema is selected by
`--model`.

```bash
ploof model run \
  --provider fal \
  --model fal-ai/flux/dev \
  --prompt "Small mascot icon for a CLI tool" \
  --param image_size=square_hd \
  --out assets/fal-icon.png \
  --output json
```

Named inputs preserve exact provider field names:

```bash
ploof model run \
  --provider fal \
  --model <fal-endpoint-id> \
  --prompt "Animate this source image" \
  --input image_url=assets/source.png \
  --param duration=4 \
  --out assets/clip.mp4
```

Model endpoint controls:

- `--param key=value`
- `--json '{...}'`
- `--input field=path-or-url`
- `--start-timeout <seconds>`
- `--timeout <seconds>`
- `--poll-interval <seconds>`
- `--priority low|normal`
- `--storage-expires-in <value>`

fal.ai commands should use queue polling and write complete returned assets or
text outputs to disk.

### Video Generation

OpenAI video generation uses the asynchronous Videos API. `ploof video generate`
submits a job; passing `--out` or `--download` makes Ploof poll until a terminal
status and download the requested asset.

```bash
ploof video generate \
  --provider openai \
  --prompt "Wide tracking shot of a paper city at blue hour" \
  --model sora-2 \
  --size 1280x720 \
  --seconds 4 \
  --out assets/clip.mp4 \
  --output json
```

First-class OpenAI video flags:

- `--model <model>`
- `--size <size>`
- `--seconds <seconds>`
- `--input-reference <path-or-url-or-file-id>`
- `--input-reference-file-id <id>`
- `--input-reference-url <url>`
- `--character <id>`
- `--wait`
- `--download`
- `--variant video|thumbnail|spritesheet`
- `--poll-interval <seconds>`
- `--timeout <seconds>`
- `--param key=value`
- `--json '{...}'`

OpenAI video generation defaults to `sora-2` when no model is specified.

### Video Editing And Library

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
ploof video character create --name Mossy --video character.mp4 --output json
ploof video character get char_abc123 --output json
```

Video edits accept either `--video-id <id>` for an existing completed OpenAI
video or `--video <path>` for an uploaded source video when the authenticated
project is eligible for that workflow. Extensions accept a source video id or
upload, plus a prompt and `--seconds`. `video remix` is supported for the SDK's
legacy remix endpoint, but new integrations should prefer `video edit`.

### Audio Generation And Processing

OpenAI audio generation uses the speech API and defaults to
`gpt-4o-mini-tts`, `alloy`, and `mp3` when model, voice, and output format are
omitted.

```bash
ploof audio generate \
  --provider openai \
  --text "Short narration for the generated asset." \
  --model gpt-4o-mini-tts \
  --voice alloy \
  --format mp3 \
  --out assets/narration.mp3 \
  --output json
```

First-class OpenAI audio generation flags:

- `--model <model>`
- `--voice <voice>`
- `--voice-id <id>`
- `--instructions <text>`
- `--format <format>` / `--response-format <format>`
- `--speed <number>`
- `--param key=value`
- `--json '{...}'`

Audio processing supports transcription and English translation:

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

Transcription first-class flags:

- `--model <model>`
- `--language <code>`
- `--prompt <prompt>`
- `--format <format>` / `--response-format <format>`
- `--temperature <number>`
- `--include <value>`
- `--timestamp-granularity word|segment`
- `--chunking-strategy auto|{...}`
- `--known-speaker-name <name>`
- `--known-speaker-reference <data-url>`
- `--param key=value`
- `--json '{...}'`

Translation first-class flags:

- `--model <model>`
- `--prompt <prompt>`
- `--format <format>` / `--response-format <format>`
- `--temperature <number>`
- `--param key=value`
- `--json '{...}'`

Ploof is a static asset generation CLI. Audio commands request complete outputs
and write them to disk. Streaming transport settings such as OpenAI
`stream=true` for transcription or `stream_format=sse` for speech are rejected
because they do not directly produce finished asset files.

### Batch Run

```bash
ploof run assets.yaml --parallel 4
```

Manifest media task kinds default to `provider: openai`; `model.run` defaults
to `provider: fal`.

Manifest example:

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

  - id: fal-icon
    kind: model.run
    provider: fal
    model: fal-ai/flux/dev
    prompt: "Small mascot icon for a CLI tool"
    params:
      image_size: square_hd
    output: assets/fal-icon.png
```

## Asset Input Model

All input/context assets are normalized before provider execution:

```ts
type AssetInput = {
  role: 'image' | 'mask' | 'reference' | 'style' | 'audio' | 'video' | string
  source: string
  mime?: string
  name?: string
}
```

Manifest `inputs` are a role map. Built-in aliases such as `images`,
`inputReference`, and `videos` normalize to `image`, `reference`, and `video`,
but providers can also consume custom roles like `style`, `control`, `pose`, or
`initImage` without changing the manifest schema.

Supported sources:

- Local paths.
- HTTP(S) URLs where the provider accepts URLs or where Ploof can download/read them.
- `-` for stdin where applicable.
- Previous task outputs in manifests.

OpenAI image editing maps:

- `role=image` to image input files.
- `role=mask` to mask file.

OpenAI video generation/editing maps:

- `role=reference` to `input_reference` for image-guided video generation.
- `role=video` to source video uploads for eligible edit/extension workflows.

OpenAI audio processing maps:

- `role=audio` to the uploaded audio file for transcription or translation.

fal.ai media commands map common roles to URL fields:

- `role=image` and `role=reference` to `image_url`.
- `role=mask` to `mask_url`.
- `role=style` to `style_image_url`.
- `role=audio` to `audio_url`.
- `role=video` to `video_url`.

fal.ai `model.run` preserves exact input field names, so
`inputs.image_url` or `--input image_url=source.png` becomes `image_url` in the
provider input payload.

Future providers can map roles such as `reference`, `style`, `init-image`, `audio`, or `video` differently.

## Provider Architecture

Provider modules implement a common interface:

```ts
type Provider = {
  id: string
  displayName?: string
  capabilities: ProviderCapability[]
  auth?: {
    apiKeyEnvVars: string[]
    apiKeyEnvPairs?: Array<{ idEnvVar: string; secretEnvVar: string }>
    organizationEnvVar?: string
    projectEnvVar?: string
    baseURLEnvVar?: string
  }
  run(job, context): Promise<ProviderResult>
}
```

The provider registry owns:

- Provider lookup.
- Auth metadata lookup.
- Capability discovery.

Provider modules own:

- Provider-specific validation.
- Provider SDK/client mapping.
- Dispatch from generic `AssetJob` objects to internal operation handlers.
- Output persistence details when the provider returns URLs, binary responses, or
  structured data.

The CLI should avoid hardcoding all provider behavior into command handlers.
Manifest execution should build generic `AssetJob` objects and call
`provider.run(job, context)` rather than calling modality-specific provider
methods directly.

## Settings Strategy

Ploof should support provider settings in three layers:

1. Stable first-class flags for common options.
2. Repeatable `--param key=value` flags.
3. Full JSON override/merge through `--json`.

This avoids a dead-end where every provider schema update requires a CLI redesign.

## Output Strategy

Default behavior:

- TTY: `table`
- Piped/non-TTY: `compact`

Supported formats:

- `table`
- `compact`
- `json`
- `jsonl`

Asset-producing commands should write the asset to disk and print structured metadata:

```json
{
  "id": "hero",
  "kind": "image.generate",
  "provider": "openai",
  "outputs": ["assets/hero.png"],
  "metadata": {
    "model": "gpt-image-2"
  }
}
```

Ploof is a static asset generation tool. Providers may use asynchronous jobs,
polling, or queue subscriptions internally, but CLI consumers receive completed
files or text outputs after the command finishes. Streaming transports should
not be exposed as the primary consumption model.

Each generated file should have an optional sidecar metadata file:

```text
assets/hero.png
assets/hero.png.json
```

The sidecar should include:

- Provider.
- Operation kind.
- Prompt.
- Params.
- Output path.
- Request metadata where available.
- Timestamp.

## Parallel Execution

The batch runner should:

- Respect `parallel` from the manifest or CLI override.
- Run independent tasks concurrently.
- Respect `needs` dependencies.
- Fail fast by default.
- Optionally continue on errors later.
- Resolve previous task outputs into dependent task inputs.

## Agent Support

Ploof must have first-class agent support.

The canonical agent reference lives in the installed CLI:

```bash
ploof learn
```

The bootstrap skill should be intentionally small:

```text
skills/asset-generation/SKILL.md
```

The skill should:

- Trigger when agents need to generate, edit, or batch-create assets.
- Tell the agent to run `ploof learn`.
- Treat `ploof learn` as the source of truth for the installed version.
- Avoid duplicating operational docs.

The CLI should also include:

```bash
ploof skill install
```

This command should either install the local bootstrap skill where feasible or print the exact install instruction for supported skill managers.

## Test Strategy

Unit tests:

- Config read/write/reset.
- Auth profile storage and env precedence.
- Output format resolution.
- Param parsing.
- Manifest parsing and dependency validation.
- Provider registry lookup.
- `ploof learn` stability.

Integration-style tests:

- CLI help exits successfully.
- Auth login/status/logout lifecycle with temp home.
- Manifest dry-run/planning behavior.

Live OpenAI tests should be opt-in only:

```bash
PLOOF_OPENAI_API_KEY=... bun test tests/e2e
```

## Non-Goals For Initial Implementation

- No browser UI.
- No cloud service.
- No keychain dependency.
- No non-OpenAI provider implementation yet.
- No hard promise that every future provider setting is a first-class flag.
- No live API tests in default CI.

## Initial Milestone Definition

The initial complete implementation should include:

- npm package scaffolding for `@miketromba/ploof`.
- Build, test, typecheck, lint setup.
- OpenAI auth profiles.
- OpenAI image generate/edit/variation.
- Asset input normalization.
- Manifest run with dependency-aware parallelism.
- Output formats and sidecar metadata.
- `ploof learn`.
- Bootstrap skill.
- README, LICENSE, GitHub Actions.
