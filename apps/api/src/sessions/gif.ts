import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ffmpegStatic from "ffmpeg-static"
import { MediaInputError } from "../mcp/media.ts"

/** ffmpeg: the one set in FFMPEG_PATH, else the binary ffmpeg-static installed, else whatever is on the PATH. */
const FFMPEG = process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string | null) || "ffmpeg"
const TIMEOUT_MS = 60_000

/**
 * A GIF as WhatsApp sends one: a short silent H.264 MP4 (it plays it looping, with gifPlayback). WhatsApp has no
 * animated-GIF message of its own; a .gif sent as a photo arrives as a still. Even dimensions (H.264 needs them),
 * yuv420p and faststart so every phone plays it.
 */
export async function gifToMp4(gif: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "parley-gif-"))
  try {
    const input = join(dir, "in.gif"), output = join(dir, "out.mp4")
    await writeFile(input, gif)
    await new Promise<void>((resolve, reject) => {
      execFile(FFMPEG, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", input,
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-profile:v", "main", "-pix_fmt", "yuv420p",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-movflags", "+faststart", output,
      ], { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, _out, stderr) => {
        if (err) reject(new MediaInputError(`couldn't turn the GIF into a video${stderr ? `: ${String(stderr).trim().slice(0, 200)}` : ""}`))
        else resolve()
      })
    })
    return new Uint8Array(await readFile(output))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
