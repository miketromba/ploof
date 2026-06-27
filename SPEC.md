# Ploof CLI Specification

## Summary

Ploof is an npm-published CLI for generating and editing assets through AI generation providers. It starts with OpenAI image and video generation/editing, but the architecture must support multiple authenticated providers, multiple asset modalities, provider-specific settings, and parallel execution across mixed jobs.

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

Version 1 starts with OpenAI only.

Initial capabilities:

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

Future providers should be added through the provider registry without changing the manifest model.

Future high-leverage provider candidates:

- fal.ai: strong multi-model generative media coverage.
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

The Ploof-specific env var wins over the provider-native env var. Stored credentials are used only when no env override is present.

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
ploof whoami [provider] [--profile default]
ploof profiles [provider]
ploof logout openai [--profile default]
```

`login`, `whoami`, `profiles`, and `logout` are the only authentication
commands. Ploof should not expose a second equivalent auth namespace.

`ploof login openai` accepts `--api-key`, reads `PLOOF_OPENAI_API_KEY` or
`OPENAI_API_KEY` when the flag is omitted, and prompts without echoing input
when run in an interactive terminal. Non-interactive login fails if no key is
provided.

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

### Batch Run

```bash
ploof run assets.yaml --parallel 4
```

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
```

## Asset Input Model

All input/context assets are normalized before provider execution:

```ts
type AssetInput = {
  role: 'image' | 'mask' | 'reference' | 'style' | 'audio' | 'video'
  source: string
  mime?: string
  name?: string
}
```

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

Future providers can map roles such as `reference`, `style`, `init-image`, `audio`, or `video` differently.

## Provider Architecture

Provider modules implement a common interface:

```ts
type Provider = {
  id: string
  capabilities: ProviderCapability[]
  runImageGenerate(job, context): Promise<ProviderResult>
  runImageEdit(job, context): Promise<ProviderResult>
  runImageVariation(job, context): Promise<ProviderResult>
  runVideoGenerate(job, context): Promise<ProviderResult>
  runVideoEdit(job, context): Promise<ProviderResult>
  runVideoExtend(job, context): Promise<ProviderResult>
  runVideoRemix(job, context): Promise<ProviderResult>
  runVideoStatus(job, context): Promise<ProviderResult>
  runVideoDownload(job, context): Promise<ProviderResult>
  runVideoList(job, context): Promise<ProviderResult>
  runVideoDelete(job, context): Promise<ProviderResult>
  runVideoCharacterCreate(job, context): Promise<ProviderResult>
  runVideoCharacterGet(job, context): Promise<ProviderResult>
}
```

The provider registry owns:

- Provider lookup.
- Capability checks.
- Credential resolution.
- Provider-specific validation.

The CLI should avoid hardcoding all provider behavior into command handlers.

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
