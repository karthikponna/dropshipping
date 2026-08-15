/**
 * `useActionState` shapes for the dashboard forms. These live outside
 * actions.ts because a `"use server"` module may only export async functions.
 */

export interface ProjectFormState {
  error: string | null;
  notice: string | null;
}

export const PROJECT_FORM_INITIAL_STATE: ProjectFormState = { error: null, notice: null };

export interface SettingsFormState {
  error: string | null;
  notice: string | null;
}

export const SETTINGS_FORM_INITIAL_STATE: SettingsFormState = { error: null, notice: null };
