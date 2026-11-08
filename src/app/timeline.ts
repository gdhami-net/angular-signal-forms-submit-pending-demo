export interface Mark {
  t: number;
  what: string;
}

declare global {
  interface Window {
    timeline?: Mark[];
  }
}

/** Adds one line to the timeline e2e.mjs reads back from the page. */
export function mark(what: string): void {
  (window.timeline ??= []).push({ t: performance.now(), what });
}
