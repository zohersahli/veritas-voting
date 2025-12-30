import { useEffect, useState } from "react";

export type ToastType = "success" | "error" | "info" | "loading";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

/**
 * Lightweight toast event bus.
 * Works across components without adding a Provider.
 */
const listeners = new Set<(toasts: Toast[]) => void>();
let toasts: Toast[] = [];

// Keep timeout handles so we can clear them on dismiss
const timeouts = new Map<string, number>();

function notify() {
  const snapshot = [...toasts];
  listeners.forEach((listener) => listener(snapshot));
}

function generateId() {
  // Prefer cryptographically secure UUID when available
  // crypto.randomUUID is available only in secure contexts (https/localhost)
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

function addToast(message: string, type: ToastType, duration: number) {
  const id = generateId();

  const newToast: Toast = {
    id,
    message,
    type,
    duration,
  };

  toasts = [...toasts, newToast];
  notify();

  if (duration > 0) {
    const handle = window.setTimeout(() => {
      removeToast(id);
    }, duration);

    timeouts.set(id, handle);
  }

  return id;
}

function removeToast(id: string) {
  const handle = timeouts.get(id);
  if (handle) {
    window.clearTimeout(handle);
    timeouts.delete(id);
  }

  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

function updateToast(id: string, next: Partial<Omit<Toast, "id">>) {
  let changed = false;

  toasts = toasts.map((t) => {
    if (t.id !== id) return t;
    changed = true;
    return { ...t, ...next };
  });

  if (changed) notify();
}

export const toast = {
  success: (message: string, duration = 3000) => addToast(message, "success", duration),
  error: (message: string, duration = 4000) => addToast(message, "error", duration),
  info: (message: string, duration = 3000) => addToast(message, "info", duration),
  loading: (message: string) => addToast(message, "loading", 0),

  // Dismiss by id
  dismiss: (id: string) => removeToast(id),

  // Optional: update an existing toast (useful for loading to success)
  update: (id: string, next: Partial<Omit<Toast, "id">>) => updateToast(id, next),

  // Optional: clear all
  clear: () => {
    timeouts.forEach((handle) => window.clearTimeout(handle));
    timeouts.clear();
    toasts = [];
    notify();
  },
};

// Vite HMR cleanup (dev only)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    timeouts.forEach((handle) => window.clearTimeout(handle));
    timeouts.clear();
    listeners.clear();
    toasts = [];
  });
}

export function useToast() {
  const [activeToasts, setActiveToasts] = useState<Toast[]>(toasts);

  useEffect(() => {
    listeners.add(setActiveToasts);
    return () => {
      listeners.delete(setActiveToasts);
    };
  }, []);

  return {
    toasts: activeToasts,
    ...toast,
  };
}
