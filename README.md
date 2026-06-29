<p align="center">
  <img src="packages/cli/assets/brand/ploof-banner.png" alt="Ploof — AI asset generation from the command line" width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@miketromba/ploof"><img src="https://img.shields.io/npm/v/@miketromba/ploof" alt="npm version" /></a>
  <a href="https://github.com/miketromba/ploof/actions/workflows/ci.yml"><img src="https://github.com/miketromba/ploof/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/miketromba/ploof/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@miketromba/ploof" alt="license" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node >= 18" />
</p>

<p align="center">
  <b>The agent-native CLI for generating images, video, and audio.</b><br/>
  Hand it to Claude Code, Cursor, or Codex — they install it, read <code>ploof learn</code>, and create your assets for you. Works great by hand, too.
</p>

---

Ploof turns a prompt into a file — and it's designed to be driven by your coding agent. The usual path isn't typing `ploof` commands yourself; it's telling Claude Code, Cursor, or Codex what you want and letting it install ploof, read the built-in `ploof learn` reference, and generate the assets on your behalf. No SDK wiring, no polling loops, no glue code — and it's a sharp manual CLI when you want it.

- 🤖 **Agent-native** — built to be operated by coding agents: `ploof learn` self-documents the *installed* version, output is JSON/JSONL-clean, and flags stay stable.
- 🎨 **Every modality** — images, video, and audio: generate, edit, extend, transcribe, translate.
- 🔌 **Multi-provider** — OpenAI today, plus fal.ai's entire model marketplace via `model run`.
- 📦 **Batch + parallel** — declare assets in YAML, wire up dependencies, run them concurrently with one command.
- 🔑 **Local auth profiles** — multiple keys per provider in `~/.ploof`, with env-var overrides for CI.
- 🧾 **Reproducible** — every asset gets a `<file>.json` sidecar recording the prompt, params, and provider metadata.

|            | Images                       | Video                                       | Audio                          | Any endpoint                |
| :--------- | :--------------------------- | :------------------------------------------ | :----------------------------- | :-------------------------- |
| **OpenAI** | generate · edit · variations | generate · edit · extend · library · characters | speech (TTS) · transcribe · translate | —                           |
| **fal.ai** | ✓                            | ✓                                           | ✓                              | ✓ marketplace via `model run` |

> More providers are planned — the provider registry is built to grow.

## Contents

- [Use it with your coding agent](#use-it-with-your-coding-agent)
- [Install](#install)
- [Quick start](#quick-start)
- [Authentication](#authentication)
- [Images](#images)
- [Video](#video)
- [Audio](#audio)
- [Run any model endpoint](#run-any-model-endpoint)
- [Batch manifests](#batch-manifests)
- [Output and scripting](#output-and-scripting)
- [For AI agents](#for-ai-agents)
- [Configuration](#configuration)
- [Reference](#reference)
- [Contributing](#contributing)

## Use it with your coding agent

**This is the main way to use ploof.** You don't run the commands yourself — you tell your coding agent what you want, and it installs ploof, reads the built-in reference, authenticates, and generates the assets for you.

Paste this into Claude Code, Cursor, Codex, or any agent, and fill in the last line:

```text
Use the ploof CLI to generate assets for this project.

Setup:
1. Install it if it isn't already: `bun i -g @miketromba/ploof` (or `npm i -g @miketromba/ploof`).
2. Run `ploof learn` and follow it — that's the canonical, always-current reference for the installed version.
3. If `ploof whoami openai` (or `ploof whoami fal`) shows I'm not authenticated, walk me through `ploof login`.

Task: <describe the asset you want — e.g. "a 1024x1024 hero image of a matte black water bottle on marble, saved to assets/hero.png">
```

Your agent takes it from `ploof learn` and does the rest. Working in this repo often? Have it run `ploof skill install` once to drop a bootstrap skill so the workflow auto-loads next time.

> **Why it works:** `ploof learn` prints a complete, version-matched guide to stdout, and every command emits clean JSON/JSONL with predictable exit codes — so agents operate ploof reliably instead of guessing or relying on stale training data. [More on the agent integration ↓](#for-ai-agents)

## Install

```bash
bun i -g @miketromba/ploof
```

Requires Node 18+ (Bun optional). Your agent normally handles this for you (see [above](#use-it-with-your-coding-agent)).

<details>
<summary>npm, pnpm, yarn, or run without installing</summary>

```bash
npm  install -g @miketromba/ploof
pnpm add     -g @miketromba/ploof
yarn global add @miketromba/ploof

# one-off, no install:
bunx @miketromba/ploof --help
npx  @miketromba/ploof --help
```

</details>

## Quick start

Prefer to drive it yourself — or want to see exactly what your agent will be doing? The manual path:

```bash
# 1 — install
bun i -g @miketromba/ploof

# 2 — authenticate (saved to ~/.ploof/credentials.json)
ploof login openai --api-key sk-...

# 3 — make your first asset
ploof image generate \
  --prompt "Studio product photo of a matte black water bottle on marble" \
  --out hero.png
```

`hero.png` lands on disk next to `hero.png.json`, a sidecar recording the exact prompt and parameters used. Run `ploof --help` to see every command, or `ploof learn` for the agent-oriented tour.

## Authentication

Credentials live in `~/.ploof/credentials.json`. Log in once per provider:

```bash
ploof login openai --api-key sk-...
ploof login fal    --api-key <fal-key>

ploof whoami openai      # show the active credential
ploof profiles           # list every stored profile
ploof logout fal         # remove credentials
```

Omit `--api-key` and Ploof reads the matching env var, or securely prompts (no echo) in an interactive terminal.

**Multiple keys?** Name them with `--profile`, then select per command:

```bash
ploof login openai --api-key sk-personal --profile personal
ploof login openai --api-key sk-work --profile work --no-default
ploof image generate --prompt "..." --profile work --out out.png
```

**Env vars override stored credentials** — ideal for CI:

| Provider | Variables                                                                            |
| :------- | :----------------------------------------------------------------------------------- |
| OpenAI   | `PLOOF_OPENAI_API_KEY` or `OPENAI_API_KEY`                                            |
| fal.ai   | `PLOOF_FAL_KEY` or `FAL_KEY` (or split `PLOOF_FAL_KEY_ID` + `PLOOF_FAL_KEY_SECRET`)   |

OpenAI org / project / base URL can be set with `--organization`, `--project`, `--base-url` (or `PLOOF_OPENAI_ORG`, `PLOOF_OPENAI_PROJECT`, `PLOOF_OPENAI_BASE_URL`).

## Images

OpenAI image generation and editing default to `gpt-image-2`. Image inputs accept local paths, `http(s)` URLs, or `-` for stdin.

```bash
# generate
ploof image generate \
  --prompt "Editorial portrait, dramatic side light" \
  --out assets/portrait.png \
  --size 1024x1024 --quality high

# edit with context images + a mask (repeat --image for references)
ploof image edit \
  --image product.png --image reference.png --mask mask.png \
  --prompt "Replace the background with a clean marble countertop" \
  --out assets/edited.png

# variations
ploof image variation --image product.png --out assets/variation.png
```

<details>
<summary>Image flags</summary>

| Flag                              | Description                                  |
| :-------------------------------- | :------------------------------------------- |
| `--model`                         | Image model (default `gpt-image-2`)          |
| `--size`                          | e.g. `1024x1024`                             |
| `--quality`                       | e.g. `low`, `medium`, `high`                 |
| `--format` / `--output-format`    | `png`, `jpeg`, `webp`, …                      |
| `--n`                             | Number of images (`--out` file gets `-1`, `-2`, …) |
| `--image` *(edit)*                | Input/context image; repeat for multiple     |
| `--mask` *(edit)*                 | Mask for inpainting                          |
| `--input-fidelity` *(edit)*       | OpenAI input fidelity                        |
| `--background`, `--moderation`, `--style`, `--user`, `--stream`, `--output-compression`, `--partial-images`, `--response-format` | Provider settings |
| `--param key=value` / `--json '{…}'` | Any provider-specific parameter           |

`variation` is aliased as `variations` and uses OpenAI's legacy endpoint, which currently supports only `dall-e-2`. If it returns a 404, use `image edit` for image-to-image instead.

</details>

## Video

OpenAI's asynchronous Videos API, defaulting to `sora-2`. Pass `--out` (or `--download`) and Ploof waits for the job to finish, then downloads it.

```bash
ploof video generate \
  --prompt "Wide tracking shot of a paper city at blue hour" \
  --size 1280x720 --seconds 4 \
  --out assets/clip.mp4

# continue an existing clip
ploof video extend --video-id video_abc123 --seconds 4 \
  --prompt "Camera rises over the rooftops" --out assets/extended.mp4

# library + lifecycle
ploof video list --limit 20
ploof video status video_abc123
ploof video download video_abc123 --variant thumbnail --out thumb.webp
ploof video delete video_abc123
```

<details>
<summary>Video flags &amp; characters</summary>

| Flag                                  | Description                              |
| :------------------------------------ | :--------------------------------------- |
| `--model`                             | `sora-2`, `sora-2-pro`, …                 |
| `--size` / `--seconds`                | Resolution / duration                    |
| `--input-reference <path\|url\|file-id>` | First-frame image reference           |
| `--character <id>`                    | Reusable character; repeat for several   |
| `--wait` / `--download`               | Poll to completion / download after wait |
| `--variant`                           | `video`, `thumbnail`, or `spritesheet`   |
| `--poll-interval` / `--timeout`       | Polling cadence / max wait (seconds)     |

`video edit` and `video extend` accept either `--video-id` (a completed OpenAI video) or `--video` (an uploaded source), where your project is eligible. Reusable characters:

```bash
ploof video character create --name Mossy --video character.mp4
ploof video character get char_abc123
```

</details>

## Audio

Speech defaults to `gpt-4o-mini-tts` / `alloy` / `mp3`. Transcription defaults to `gpt-4o-mini-transcribe`; translation to `whisper-1`.

```bash
# text → speech
ploof audio generate --text "Ploof can speak." --voice alloy --out assets/speech.mp3

# speech → text
ploof audio transcribe --audio assets/speech.mp3 --out assets/transcript.json

# any language → English text
ploof audio translate --audio assets/spanish.mp3 --format text --out assets/translation.txt
```

<details>
<summary>Audio flags</summary>

**Generate** (`generate`, aliased `speech` / `tts`): `--model`, `--voice`, `--voice-id`, `--instructions`, `--format` (`mp3`, `opus`, `aac`, `flac`, `wav`, `pcm`), `--speed`.

**Transcribe**: `--model`, `--language`, `--prompt`, `--format`, `--temperature`, `--include`, `--timestamp-granularity`, `--chunking-strategy`, `--known-speaker-name`, `--known-speaker-reference`.

**Translate**: `--model`, `--prompt`, `--format`, `--temperature`.

Ploof writes finished files, so streaming-only transport settings (e.g. `stream=true`) are rejected — they don't produce a complete asset.

</details>

## Run any model endpoint

`model run` calls a model endpoint directly through the provider's official client — defaulting to **fal.ai**. Ploof uploads local inputs to provider storage, submits to the queue, polls to completion, and writes the returned files or text to disk.

```bash
ploof model run \
  --provider fal --model fal-ai/flux/dev \
  --prompt "Friendly CLI mascot icon, transparent background" \
  --param image_size=square_hd \
  --out assets/icon.png
```

Map local assets to the endpoint's exact input fields with `--input field=path` (repeatable):

```bash
ploof model run --provider fal --model <endpoint-id> \
  --prompt "Animate this into a short loop" \
  --input image_url=assets/source.png --param duration=4 \
  --out assets/loop.mp4
```

The media commands work against fal too — just pass `--provider fal --model <endpoint-id>`:

```bash
ploof image generate --provider fal --model fal-ai/flux/dev \
  --prompt "Soft clay mascot icon" --param image_size=square_hd --out assets/mascot.png
```

Pass endpoint settings with `--param key=value` or `--json '{…}'`. Queue controls: `--start-timeout`, `--timeout`, `--poll-interval`, `--priority low|normal`, `--storage-expires-in`.

## Batch manifests

Describe many assets in YAML (or JSON), wire dependencies with `needs`, reuse one task's output as another's input, and run them in parallel:

```yaml
version: 1
parallel: 4
tasks:
  - id: base
    kind: image.generate
    prompt: "Studio product photo"
    params: { model: gpt-image-2, size: 1024x1024, quality: high }
    output: assets/base.png

  - id: final
    kind: image.edit
    needs: [base]
    inputs:
      images:
        - task: base          # reuse base's output
      mask: ./mask.png
    prompt: "Add a premium background"
    output: assets/final.png

  - id: clip
    kind: video.generate
    prompt: "Slow dolly through a miniature paper city"
    params: { model: sora-2, size: 1280x720, seconds: "4" }
    wait: true
    download: true
    output: assets/clip.mp4

  - id: icon
    kind: model.run
    provider: fal
    model: fal-ai/flux/dev
    prompt: "Small mascot icon"
    params: { image_size: square_hd }
    output: assets/icon.png
```

```bash
ploof run assets.yaml --parallel 4
ploof run assets.yaml --dry-run --output json   # validate the plan, no API calls
```

Media tasks default to `provider: openai`; `model.run` defaults to `provider: fal`. Relative paths resolve from the manifest's location, and every CLI operation is available as a task kind (`image.*`, `video.*`, `audio.*`, `model.run`).

<details>
<summary>Task fields &amp; input references</summary>

- **Fields:** `id`, `kind`, `provider`, `profile`, `needs`, `model`, `prompt`, `text`, `output`, `params`, `sidecar`, `inputs`, `videoId`, `characterId`, `name`, `wait`, `download`, `variants`, `pollIntervalMs`, `timeoutMs`.
- **`inputs.images`** accepts a string, `{ source }`, or `{ task }` (uses that task's first output). `inputs.video(s)`, `inputs.mask`, `inputs.reference`, and `inputs.audio` use the same shape.
- **`model.run`** preserves exact input keys, so `inputs.image_url` maps to the provider field `image_url`.
- Always `--dry-run` before an expensive batch.

</details>

## Output and scripting

Human-readable in a terminal, machine-readable in a pipe — automatically:

```bash
ploof image generate --prompt "..." --output json
ploof run assets.yaml --output jsonl
ploof video list --fields id,outputs,metadata.video.status
```

| Format             | When                                          |
| :----------------- | :-------------------------------------------- |
| `auto` *(default)* | `table` in a TTY, `compact` when piped        |
| `table`            | Human-readable columns                        |
| `compact`          | One line per asset, easy to grep              |
| `json` / `jsonl`   | Programmatic / streaming                       |

Every result is a stable object:

```json
{
  "kind": "video.generate",
  "provider": "openai",
  "outputs": ["assets/clip.mp4"],
  "metadata": { "video": { "id": "video_…", "status": "completed" } }
}
```

**Sidecars:** unless disabled, each asset gets a `<output>.json` beside it recording the operation, prompt, params, outputs, and provider metadata — reproducible by default. Narrow output with `--fields a,b.c`, and set the default format via `--output`, the `PLOOF_OUTPUT` env var, or `ploof config set output …`.

## For AI agents

The [copy-paste setup above](#use-it-with-your-coding-agent) is all most agents need. Here's what's happening under the hood — two commands carry the integration:

```bash
ploof learn          # canonical, version-matched agent reference (prints to stdout)
ploof skill install  # install a bootstrap skill into your agent
```

`ploof learn` is the source of truth — it documents every command, default, and gotcha for the *exact installed version*, so an agent never works from stale memory. The installed skill is intentionally tiny: it just points back at `ploof learn`, keeping guidance in lockstep with the package. Combined with `--output json` (or `jsonl`), `--fields` selection, and predictable exit codes, ploof is built for hands-off automation.

## Configuration

```bash
ploof config list
ploof config set output compact
ploof config set defaultParallel 8
ploof config set sidecar false
ploof config reset
```

Stored at `~/.ploof/config.json`, separate from credentials.

| Key               | Default | Meaning                          |
| :---------------- | :------ | :------------------------------- |
| `output`          | `auto`  | Default output format            |
| `defaultParallel` | `4`     | Default `run` concurrency        |
| `sidecar`         | `true`  | Write `<file>.json` metadata     |
| `noColor`         | `false` | Disable ANSI color               |

## Reference

<details>
<summary>Global flags</summary>

| Flag                          | Description                                  |
| :---------------------------- | :------------------------------------------- |
| `-o, --output <format>`       | `auto`, `table`, `compact`, `json`, `jsonl`  |
| `-f, --fields <list>`         | Comma-separated field selection              |
| `-d, --detail`                | Full detail view                             |
| `-q, --quiet`                 | Data only, no hints                          |
| `--no-color`                  | Disable color                                |
| `--verbose`                   | Debug output to stderr                       |
| `-y, --yes`                   | Skip confirmation prompts                    |
| `-V, --version` / `-h, --help`| Version / help                               |

Run `ploof <command> --help` for any subcommand.

</details>

<details>
<summary>Environment variables</summary>

| Variable                                                                  | Purpose                          |
| :------------------------------------------------------------------------ | :------------------------------- |
| `PLOOF_OPENAI_API_KEY`, `OPENAI_API_KEY`                                  | OpenAI key                       |
| `PLOOF_OPENAI_ORG`, `PLOOF_OPENAI_PROJECT`, `PLOOF_OPENAI_BASE_URL`       | OpenAI org / project / base URL  |
| `PLOOF_FAL_KEY`, `FAL_KEY`                                                | fal.ai key                       |
| `PLOOF_FAL_KEY_ID` + `PLOOF_FAL_KEY_SECRET` (or `FAL_KEY_ID` + `FAL_KEY_SECRET`) | fal.ai split key          |
| `PLOOF_OUTPUT`                                                            | Default output format            |

</details>

## Contributing

```bash
bun install
bun run dev -- --help     # run locally
bun test                  # unit + integration (mocked, no API spend)
bun run typecheck
bun run lint
bun run build
```

The default suite runs real `ploof` commands against a local OpenAI mock plus fal unit tests, so no credits are spent. Live tests are opt-in:

```bash
PLOOF_OPENAI_API_KEY=sk-... bun test tests/e2e
PLOOF_FAL_KEY=...           bun test tests/e2e/fal-live.test.ts
```

Releases publish from GitHub Actions on a `v*` tag via npm Trusted Publishing. See [`SPEC.md`](packages/cli/SPEC.md) for the full specification and release details.

## License

[MIT](LICENSE) © Michael Tromba
