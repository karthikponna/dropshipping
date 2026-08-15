"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { clearAnthropicKey, looksLikeAnthropicKey, saveAnthropicKey } from "@/lib/anthropic-key";
import { SUPABASE_SETUP_HINT } from "@/lib/supabase/env";
import { GenerationError, isPageType, type PageType } from "@/lib/types";

import { getDashboardSession } from "./data";
import { deriveProjectName } from "./format";
import type { ProjectFormState, SettingsFormState } from "./form-state";

/**
 * Mutations behind the dashboard forms. All four are shaped for React's
 * `useActionState`: `(prevState, formData) => Promise<State>`. Their state
 * types and initial values live in ./form-state — this module may only export
 * async functions.
 */

const MIN_PROMPT_LENGTH = 8;
const MAX_PROMPT_LENGTH = 4000;
const MAX_NAME_LENGTH = 80;

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

const SIGNED_OUT_MESSAGE = "Your session expired. Sign in again to continue.";

/**
 * The dock's submit path: create the project row, then hand off to the builder
 * with `autostart=1` so Wave 3 kicks off the first generation on arrival.
 *
 * Fields: `prompt` (required), `pageType` (`landing` | `product`).
 */
export async function createProjectFromPromptAction(
  _prevState: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const prompt = readField(formData, "prompt").slice(0, MAX_PROMPT_LENGTH);
  const rawPageType = readField(formData, "pageType");
  const pageType: PageType = isPageType(rawPageType) ? rawPageType : "landing";

  if (prompt.length < MIN_PROMPT_LENGTH) {
    return { error: "Describe the shop in a sentence so the model has something to work with.", notice: null };
  }

  const session = await getDashboardSession();
  if (session.status === "unconfigured") return { error: SUPABASE_SETUP_HINT, notice: null };
  if (session.status === "signed_out") return { error: SIGNED_OUT_MESSAGE, notice: null };

  const { data, error } = await session.supabase
    .from("projects")
    .insert({
      user_id: session.user.id,
      name: deriveProjectName(prompt),
      page_type: pageType,
      initial_prompt: prompt,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "The page could not be created.", notice: null };
  }

  const projectId = (data as { id: string }).id;

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/projects");
  redirect(`/dashboard/projects/${projectId}?autostart=1`);
}

/** Fields: `projectId`, `name`. */
export async function renameProjectAction(
  _prevState: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const projectId = readField(formData, "projectId");
  const name = readField(formData, "name").slice(0, MAX_NAME_LENGTH);

  if (!projectId) return { error: "That page could not be found.", notice: null };
  if (name.length === 0) return { error: "Give the page a name.", notice: null };

  const session = await getDashboardSession();
  if (session.status === "unconfigured") return { error: SUPABASE_SETUP_HINT, notice: null };
  if (session.status === "signed_out") return { error: SIGNED_OUT_MESSAGE, notice: null };

  const { error } = await session.supabase.from("projects").update({ name }).eq("id", projectId);
  if (error) return { error: error.message, notice: null };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/projects");
  return { error: null, notice: "Renamed" };
}

/** Fields: `projectId`. Versions cascade with the project row. */
export async function deleteProjectAction(
  _prevState: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const projectId = readField(formData, "projectId");
  if (!projectId) return { error: "That page could not be found.", notice: null };

  const session = await getDashboardSession();
  if (session.status === "unconfigured") return { error: SUPABASE_SETUP_HINT, notice: null };
  if (session.status === "signed_out") return { error: SIGNED_OUT_MESSAGE, notice: null };

  const { error } = await session.supabase.from("projects").delete().eq("id", projectId);
  if (error) return { error: error.message, notice: null };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/projects");
  return { error: null, notice: "Deleted" };
}

/**
 * Settings key field. Fields: `intent` (`save` | `clear`) and `apiKey` for
 * `save`. The plaintext key never leaves this action — it goes straight into
 * `saveAnthropicKey`, which encrypts it.
 */
export async function manageApiKeyAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const intent = readField(formData, "intent");

  try {
    if (intent === "clear") {
      await clearAnthropicKey();
      revalidatePath("/dashboard/settings");
      return { error: null, notice: "Key removed. Generation falls back to the server key." };
    }

    const apiKey = readField(formData, "apiKey");
    if (apiKey.length === 0) {
      return { error: "Paste a key to save.", notice: null };
    }
    if (!looksLikeAnthropicKey(apiKey)) {
      return { error: 'That does not look like an Anthropic key — they start with "sk-ant-".', notice: null };
    }

    await saveAnthropicKey(apiKey);
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard");
    return { error: null, notice: "Key saved" };
  } catch (error) {
    if (error instanceof GenerationError) return { error: error.message, notice: null };
    return { error: "The key could not be saved. Check the server logs.", notice: null };
  }
}
