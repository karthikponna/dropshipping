"use client";

import { useActionState } from "react";

import { manageApiKeyAction } from "./actions";
import { SETTINGS_FORM_INITIAL_STATE } from "./form-state";
import { KeyIcon } from "./icons";

interface ApiKeyFormProps {
  /** Masked preview of the stored key — the plaintext never reaches the client. */
  maskedKey: string | null;
  /** Non-null when the key cannot be stored yet; the field is disabled. */
  unavailableReason: string | null;
}

const GHOST_BUTTON =
  "inline-flex h-amb-control items-center rounded-amb-row border border-amb-border px-2.5 text-[14px] text-amb-foreground transition-colors hover:bg-amb-muted disabled:opacity-50";

export function ApiKeyForm({ maskedKey, unavailableReason }: ApiKeyFormProps) {
  const [state, formAction, pending] = useActionState(
    manageApiKeyAction,
    SETTINGS_FORM_INITIAL_STATE,
  );
  const disabled = unavailableReason !== null || pending;

  return (
    <div>
      {maskedKey && (
        <div className="flex flex-wrap items-center gap-3 rounded-amb-control border border-amb-border bg-amb-muted px-3 py-2">
          <KeyIcon className="h-4 w-4 text-amb-muted-foreground" />
          <code className="font-amb-mono text-[13px] text-amb-foreground">{maskedKey}</code>
          <form action={formAction} className="ml-auto">
            <input type="hidden" name="intent" value="clear" />
            <button type="submit" disabled={pending} className={GHOST_BUTTON}>
              {pending ? "Working" : "Remove key"}
            </button>
          </form>
        </div>
      )}

      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="intent" value="save" />
        <div className="min-w-0 flex-1">
          <label
            htmlFor="apiKey"
            className="block text-[14px] font-medium tracking-[-0.02em] text-amb-foreground"
          >
            {maskedKey ? "Replace key" : "Anthropic API key"}
          </label>
          <input
            id="apiKey"
            name="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            minLength={20}
            placeholder="sk-ant-…"
            disabled={unavailableReason !== null}
            className="mt-2 h-9 w-full rounded-amb-control border border-amb-input bg-amb-card px-3 font-amb-mono text-[13px] text-amb-foreground placeholder:text-amb-muted-foreground focus:border-amb-ring focus:outline-none disabled:bg-amb-muted"
          />
        </div>
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex h-9 items-center rounded-amb-row bg-amb-primary px-3.5 text-[14px] font-medium text-amb-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving" : "Save key"}
        </button>
      </form>

      {unavailableReason && (
        <p className="mt-3 text-[13px] text-amb-warning">{unavailableReason}</p>
      )}
      {state.error && (
        <p role="alert" className="mt-3 text-[13px] text-amb-destructive">
          {state.error}
        </p>
      )}
      {state.notice && <p className="mt-3 text-[13px] text-amb-success">{state.notice}</p>}
    </div>
  );
}
