import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/@ffmpeg/core/dist/esm");
const target = resolve(root, "public/ffmpeg");

await mkdir(target, { recursive: true });
const wasm = await readFile(resolve(source, "ffmpeg-core.wasm"));
const midpoint = Math.ceil(wasm.length / 2);
await Promise.all([
  copyFile(resolve(source, "ffmpeg-core.js"), resolve(target, "ffmpeg-core.js")),
  writeFile(resolve(target, "ffmpeg-core.wasm.part1"), wasm.subarray(0, midpoint)),
  writeFile(resolve(target, "ffmpeg-core.wasm.part2"), wasm.subarray(midpoint)),
  rm(resolve(target, "ffmpeg-core.wasm"), { force: true }),
]);
