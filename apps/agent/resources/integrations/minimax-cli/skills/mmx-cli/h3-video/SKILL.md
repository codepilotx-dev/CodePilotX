---
name: mmx-h3-video
description: Generate and download MiniMax-H3 videos through the installed official mmx CLI without duplicating paid tasks.
---

# MiniMax-H3 Video

Use this skill only for `MiniMax-H3` video generation.

Rules:

1. Run `mmx auth status --output json --quiet` before the first paid request. H3 may require a Pay-as-you-go/Credit API key rather than a Token Plan key.
2. Never put a literal API key in the command.
3. Always pass `--model MiniMax-H3`.
4. For a completed file, run one blocking command and wait on that exact process. Never resubmit merely because polling or downloading was interrupted.
5. Use `--async` only when the user explicitly asks for a task ID without waiting.

```bash
mmx video generate \
  --model MiniMax-H3 \
  --prompt "<prompt>" \
  --duration <4-15> \
  --download "<output.mp4>" \
  --poll-interval 10 \
  --timeout 1800 \
  --non-interactive \
  --quiet
```

Frame mode uses `--image` and optional `--last-frame`. Reference mode uses repeated `--reference-image`, `--reference-video`, and `--reference-audio` flags; do not mix frame and reference modes.

If a task ID has been returned, all recovery must continue that task. Authentication, balance, validation, or content-filter failures stop immediately. A region retry is allowed at most once and only when the first request clearly failed before task creation because of region routing.

Source: https://github.com/MiniMax-AI/cli
