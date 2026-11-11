import { setPageVisible } from "./page-visibility.ts";
import { beforeEach, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
beforeEach(() => setPageVisible(true));
afterEach(() => cleanup());
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
// jsdom has no layout/scroll engine; Radix uses this browser method when focusing an option.
HTMLElement.prototype.scrollIntoView = vi.fn();
