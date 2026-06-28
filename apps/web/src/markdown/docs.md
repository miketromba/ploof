# Ploof documentation

Ploof is the agent-native CLI for generating and editing images, video, and audio. It supports OpenAI image, video, and audio, plus fal.ai's model marketplace through `model run` — all behind one consistent, scriptable command surface that writes finished files to disk.

- Package: `@miketromba/ploof`, command `ploof`
- Providers: OpenAI and fal.ai (more planned)
- Requires: Node 18+ (Bun optional)

The canonical, always-current reference is the `ploof learn` command, which prints full agent instructions for the exact installed version.

## Install

```bash
bun i -g @miketromba/ploof
# or
npm  i -g @miketromba/ploof
pnpm add -g @miketromba/ploof

# run once without installing
bunx @miketromba/ploof --help
```

## Use with an agent

This is the primary path. Paste the prompt below into Claude Code, Cursor, or Codex — it installs Ploof, reads `ploof learn`, authenticates, and generates your assets.

```text
{{AGENT_PROMPT}}
```

Working in a repo often? Have the agent run `ploof skill install` once to drop a bootstrap skill so the workflow auto-loads next time.

## Authentication

Credentials are stored locally in `~/.ploof/credentials.json`.

```bash
ploof login openai --api-key sk-...
ploof login fal    --api-key <fal-key>

ploof whoami openai      # show the active credential
ploof profiles           # list every stored profile
ploof logout fal         # remove credentials
```

Omit `--api-key` and Ploof reads the matching environment variable, or securely prompts (no echo) in an interactive terminal. Name multiple keys with `--profile` and select per command.

| Provider | Environment variables |
| --- | --- |
| OpenAI | `PLOOF_OPENAI_API_KEY` or `OPENAI_API_KEY` |
| fal.ai | `PLOOF_FAL_KEY` or `FAL_KEY` (or split `PLOOF_FAL_KEY_ID` + `PLOOF_FAL_KEY_SECRET`) |

## Images

Generation and editing default to OpenAI `gpt-image-2`. Inputs accept local paths, `http(s)` URLs, or `-` for stdin.

```bash
# generate
ploof image generate \
  --prompt "Editorial portrait, dramatic side light" \
  --out assets/portrait.png --size 1024x1024 --quality high

# edit with context images + a mask (repeat --image)
ploof image edit \
  --image product.png --image reference.png --mask mask.png \
  --prompt "Replace the background with marble" \
  --out assets/edited.png

# variations (legacy dall-e-2 endpoint)
ploof image variation --image product.png --out assets/variation.png
```

Key flags: `--model`, `--size`, `--quality`, `--format`, `--n`, `--background`, plus `--param key=value` / `--json '{...}'` for anything provider-specific.

## Video

OpenAI's asynchronous Videos API, defaulting to `sora-2`. Pass `--out` (or `--download`) and Ploof waits for the job, then downloads it.

```bash
ploof video generate \
  --prompt "Wide tracking shot of a paper city at blue hour" \
  --size 1280x720 --seconds 4 --out assets/clip.mp4

ploof video extend --video-id video_abc123 --seconds 4 \
  --prompt "Camera rises over the rooftops" --out assets/extended.mp4

ploof video list --limit 20
ploof video download video_abc123 --variant thumbnail --out thumb.webp
```

Also: `--input-reference` for a first-frame image, `--character` for reusable characters, and `--wait` / `--poll-interval` / `--timeout` for lifecycle control.

## Audio

Speech defaults to `gpt-4o-mini-tts` / `alloy` / `mp3`. Transcription defaults to `gpt-4o-mini-transcribe`; translation to `whisper-1`.

```bash
# text -> speech
ploof audio generate --text "Ploof can speak." --voice alloy --out speech.mp3

# speech -> text
ploof audio transcribe --audio speech.mp3 --out transcript.json

# any language -> English text
ploof audio translate --audio spanish.mp3 --format text --out out.txt
```

## Any model endpoint

`model run` calls an endpoint directly through the provider's official client — defaulting to fal.ai. Ploof uploads local inputs, submits to the queue, polls to completion, and writes the results.

```bash
ploof model run \
  --provider fal --model fal-ai/flux/dev \
  --prompt "Friendly CLI mascot icon, transparent background" \
  --param image_size=square_hd \
  --out assets/icon.png

# map local assets to exact provider input fields (repeatable)
ploof model run --provider fal --model <endpoint-id> \
  --prompt "Animate this into a loop" \
  --input image_url=assets/source.png --param duration=4 \
  --out assets/loop.mp4
```

## Batch manifests

Describe many assets in YAML (or JSON), wire dependencies with `needs`, reuse one task's output as another's input, and run them in parallel.

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
    needs: [base]          # runs after base, reuses its output
    inputs:
      images:
        - task: base
      mask: ./mask.png
    prompt: "Add a premium background"
    output: assets/final.png

  - id: clip
    kind: video.generate
    prompt: "Slow dolly through a paper city"
    params: { model: sora-2, size: 1280x720, seconds: "4" }
    wait: true
    download: true
    output: assets/clip.mp4
```

```bash
ploof run assets.yaml --parallel 4
ploof run assets.yaml --dry-run --output json   # validate, no API calls
```

Media tasks default to `provider: openai`; `model.run` defaults to `provider: fal`. Relative paths resolve from the manifest's location.

## Output & scripting

Human-readable in a terminal, machine-readable in a pipe — automatically.

| Format | When |
| --- | --- |
| `auto` (default) | `table` in a TTY, `compact` when piped |
| `table` | Human-readable columns |
| `compact` | One line per asset, easy to grep |
| `json` / `jsonl` | Programmatic / streaming |

Every result is a stable object, and each asset gets a `<file>.json` sidecar recording the prompt, params, and provider metadata — reproducible by default.

```json
{
  "kind": "video.generate",
  "provider": "openai",
  "outputs": ["assets/clip.mp4"],
  "metadata": { "video": { "id": "video_...", "status": "completed" } }
}
```

Narrow output with `--fields a,b.c`, or set a default via `--output`, `PLOOF_OUTPUT`, or `ploof config set output ...`.

## Configuration

```bash
ploof config list
ploof config set output compact
ploof config set defaultParallel 8
ploof config set sidecar false
ploof config reset
```

| Key | Default | Meaning |
| --- | --- | --- |
| `output` | `auto` | Default output format |
| `defaultParallel` | `4` | Default `run` concurrency |
| `sidecar` | `true` | Write `<file>.json` metadata |
| `noColor` | `false` | Disable ANSI color |

## Reference

Global flags work on any command: `-o/--output`, `-f/--fields`, `-d/--detail`, `-q/--quiet`, `--no-color`, `--verbose`, `-y/--yes`. Run `ploof <command> --help` for any subcommand.

- npm: https://www.npmjs.com/package/@miketromba/ploof
- GitHub: https://github.com/miketromba/ploof
- Full README: https://github.com/miketromba/ploof/blob/main/packages/cli/README.md
