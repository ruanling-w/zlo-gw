import { spawn } from "node:child_process";
import type { HermesRunInput, HermesRunResult, HermesRunner } from "./types.js";

export class HermesCliRunner implements HermesRunner {
  constructor(private readonly command: string) {}

  async run(input: HermesRunInput): Promise<HermesRunResult> {
    return new Promise((resolve) => {
      const child = spawn(this.command, ["--continue", input.sessionId, "-z", input.prompt], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({ ok: false, error: "Hermes CLI timed out" });
      }, input.timeoutMs);

      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          return resolve({ ok: true, text: stdout.trim() });
        }
        return resolve({ ok: false, error: stderr.trim() || `Hermes CLI exited with code ${code}` });
      });
    });
  }
}
