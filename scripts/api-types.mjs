// Download upstream declarations for development; do not redistribute Anthropic's files.
import { mkdir, writeFile } from "node:fs/promises";
const revision = "71cdddec623889d38af14b7a489670a03186f659";
const response = await fetch(
  `https://raw.githubusercontent.com/anthropics/claude-code/${revision}/mods/types/claude-code.d.ts`,
);
if (!response.ok)
  throw new Error(`API type download failed: ${response.status}`);
await mkdir(new URL("../types/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../types/claude-code.d.ts", import.meta.url),
  await response.text(),
);
