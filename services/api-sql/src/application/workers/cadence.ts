export function sleep(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * Cloud Scheduler's floor is one minute. Tick `work` every `intervalMs` until
 * `durationMs` elapses so a 10-second Worldpay sweep can run inside that minute.
 */
export async function runEvery(intervalMs: number, durationMs: number, work: () => Promise<void>) {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    const started = Date.now();
    await work();
    const wait = intervalMs - (Date.now() - started);
    if (Date.now() + Math.max(0, wait) >= deadline) break;
    if (wait > 0) await sleep(wait);
  }
}
