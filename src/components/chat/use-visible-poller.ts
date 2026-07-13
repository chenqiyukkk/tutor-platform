"use client";

import { useEffect } from "react";

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 30_000;

export function useVisiblePoller({
  enabled,
  generation,
  pull,
}: {
  enabled: boolean;
  generation: number;
  pull(signal: AbortSignal): Promise<{ hasMore: boolean }>;
}) {
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let delay = POLL_INTERVAL_MS;

    function clearTimer() {
      if (timer) clearTimeout(timer);
      timer = null;
    }

    function schedule(milliseconds: number) {
      if (disposed || document.visibilityState !== "visible") return;
      clearTimer();
      timer = setTimeout(() => { void run(); }, milliseconds);
    }

    async function run() {
      if (disposed || document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      try {
        let result: { hasMore: boolean };
        do {
          result = await pull(controller.signal);
        } while (result.hasMore && !disposed && document.visibilityState === "visible");
        if (disposed) return;
        delay = POLL_INTERVAL_MS;
        schedule(POLL_INTERVAL_MS);
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
        schedule(delay);
        delay = Math.min(delay * 2, MAX_POLL_INTERVAL_MS);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        clearTimer();
        controller?.abort();
        return;
      }
      delay = POLL_INTERVAL_MS;
      clearTimer();
      void run();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, generation, pull]);
}
