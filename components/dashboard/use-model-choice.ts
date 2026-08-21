"use client";

import { useCallback, useEffect, useState } from "react";

import {
  FALLBACK_MODEL_CHOICES,
  GENERATION_MODEL,
  isModelId,
  type ModelChoice,
  type ModelsResponse,
} from "@/lib/ai/model";

/**
 * Which Anthropic model the next generation runs on, and the list to pick from.
 *
 * The list is fetched once per page load and shared by every composer that
 * mounts — the catalogue is per API key, not per project, and re-asking on each
 * navigation would spend a round trip to learn the same four lines. The choice
 * itself is kept in `localStorage` rather than on the project: it is a
 * preference about how the user likes to work, so it should follow them to the
 * next shop instead of resetting to the default.
 *
 * Storing it this way is also what carries the dock's choice into the builder.
 * The dock submits to a server action and arrives as a fresh page load, so
 * there is no client state to hand over; the autostarted run reads the same key.
 */

const STORAGE_KEY = "dropshipping.model";

/** Resolved once per page load; shared across mounts and awaited by latecomers. */
let catalogue: Promise<ModelChoice[]> | null = null;

async function loadCatalogue(): Promise<ModelChoice[]> {
  try {
    const response = await fetch("/api/models", { headers: { Accept: "application/json" } });
    if (!response.ok) return [...FALLBACK_MODEL_CHOICES];

    const body = (await response.json()) as Partial<ModelsResponse>;
    const models = (body.models ?? []).filter(
      (model): model is ModelChoice =>
        typeof model?.id === "string" && isModelId(model.id) && typeof model.label === "string",
    );
    return models.length > 0 ? models : [...FALLBACK_MODEL_CHOICES];
  } catch {
    return [...FALLBACK_MODEL_CHOICES];
  }
}

/** The last model the user picked, from any composer, or null if they never have. */
export function readStoredModel(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored !== null && isModelId(stored) ? stored : null;
  } catch {
    return null;
  }
}

export interface ModelChoiceState {
  /** Everything selectable, newest first. Never empty. */
  models: readonly ModelChoice[];
  /** The id every generation from this composer should carry. */
  selected: string;
  select: (id: string) => void;
  /** True until the catalogue lands, so the control can hold its width. */
  loading: boolean;
}

export function useModelChoice(): ModelChoiceState {
  const [models, setModels] = useState<readonly ModelChoice[]>(FALLBACK_MODEL_CHOICES);
  const [loading, setLoading] = useState(true);

  // Read on mount rather than in the initialiser: the server render has no
  // localStorage, and seeding state from it directly would mismatch hydration.
  const [selected, setSelected] = useState<string>(GENERATION_MODEL);
  useEffect(() => {
    const stored = readStoredModel();
    if (stored) setSelected(stored);
  }, []);

  useEffect(() => {
    let live = true;
    catalogue ??= loadCatalogue();

    void catalogue.then((list) => {
      if (!live) return;
      setModels(list);
      setLoading(false);
    });

    return () => {
      live = false;
    };
  }, []);

  const select = useCallback((id: string): void => {
    if (!isModelId(id)) return;
    setSelected(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Private browsing refuses writes; the choice still holds for this page.
    }
  }, []);

  return { models, selected, select, loading };
}
