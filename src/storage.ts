import { mkdir, readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export async function readJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}
export async function atomic(path: string, value: unknown) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
  try {
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}
export class Busy extends Error {}
/** Atomic directory creation elects one local process; live owners are never evicted. */
export async function withLock<T>(
  dir: string,
  task: () => Promise<T>,
): Promise<T> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, "lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (e: any) {
    if (e.code !== "EEXIST") throw e;
    const owner = await readJSON<{ pid: number } | null>(
      join(lock, "owner.json"),
      null,
    );
    let dead = false;
    if (owner && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0);
      } catch (e: any) {
        dead = e.code === "ESRCH";
      }
    }
    // No automatic stealing: a separate contender may already be reclaiming it.
    throw new Busy(
      dead
        ? "Previous cache owner exited. Run clear-cache to recover."
        : "Another session is refreshing the cache.",
    );
  }
  try {
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid }),
      { mode: 0o600 },
    );
    return await task();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
export async function recoverDeadLock(dir: string) {
  const lock = join(dir, "lock");
  const owner = await readJSON<{ pid: number } | null>(
    join(lock, "owner.json"),
    null,
  );
  if (owner) {
    try {
      process.kill(owner.pid, 0);
      throw new Busy("A refresh is still running; retry later.");
    } catch (e: any) {
      if (e.code !== "ESRCH") throw e;
    }
  } else {
    const s = await stat(lock).catch(() => null);
    if (s && Date.now() - s.mtimeMs < 120000)
      throw new Busy("Cache lock is being created; retry later.");
  }
  await rm(lock, { recursive: true, force: true });
}
