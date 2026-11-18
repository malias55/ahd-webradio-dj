import { spawnSync } from "node:child_process";

// FFmpeg 6.1 and later send the first half second of every input at once
// before pacing it ("initial burst"). Each title therefore reached listeners
// half a second early: the programme ran faster than real time, receiver
// buffers grew title by title, and fades started from a position that had
// already been sent. Disable the burst where FFmpeg has it; older versions
// neither burst nor know the option.
let flags: string[] | undefined;
export function realtime(): string[] {
  if (flags) return flags;
  let supported = false;
  try {
    const help = spawnSync(/* turbopackIgnore: true */ process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-h", "full"], { encoding: "utf8", timeout: 10_000, maxBuffer: 32 * 1024 * 1024 });
    supported = `${help.stdout}${help.stderr}`.includes("readrate_initial_burst");
  } catch { /* Without FFmpeg nothing plays at all; keep the plain option. */ }
  // Zero means "use the default burst", so request the smallest real value.
  return flags = supported ? ["-readrate_initial_burst", "0.001", "-re"] : ["-re"];
}
