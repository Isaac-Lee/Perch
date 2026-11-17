// Builds perch-hook and copies it to src-tauri/binaries/ under the name Tauri's externalBin expects.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const tauri = join(import.meta.dirname, "..", "src-tauri");
execFileSync("cargo", ["build", "-p", "perch-hook", "--release"], { cwd: tauri, stdio: "inherit" });
const triple = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1];
const ext = process.platform === "win32" ? ".exe" : "";
mkdirSync(join(tauri, "binaries"), { recursive: true });
copyFileSync(join(tauri, "target", "release", `perch-hook${ext}`), join(tauri, "binaries", `perch-hook-${triple}${ext}`));
