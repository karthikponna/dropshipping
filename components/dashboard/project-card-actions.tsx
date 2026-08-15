"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { deleteProjectAction, renameProjectAction } from "./actions";
import { PROJECT_FORM_INITIAL_STATE } from "./form-state";
import { ArrowRightIcon, PencilIcon, TrashIcon } from "./icons";

const GHOST_ICON =
  "flex h-7 w-7 items-center justify-center rounded-amb-row border border-amb-border text-amb-muted-foreground transition-colors hover:bg-amb-muted hover:text-amb-foreground disabled:opacity-50";

const GHOST_BUTTON =
  "inline-flex h-amb-control items-center gap-1.5 rounded-amb-row border border-amb-border px-2.5 text-[14px] text-amb-foreground transition-colors hover:bg-amb-muted disabled:opacity-50";

type Mode = "idle" | "rename" | "delete";

interface ProjectCardActionsProps {
  projectId: string;
  projectName: string;
  builderHref: string;
}

/** Card footer: open the builder, or switch into rename / confirm-delete. */
export function ProjectCardActions({
  projectId,
  projectName,
  builderHref,
}: ProjectCardActionsProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [renameState, renameAction, renamePending] = useActionState(
    renameProjectAction,
    PROJECT_FORM_INITIAL_STATE,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteProjectAction,
    PROJECT_FORM_INITIAL_STATE,
  );

  // Close the rename form when a submission finishes cleanly. Watching the
  // pending flag rather than the returned notice means repeat renames also close.
  const renameWasPending = useRef(false);
  useEffect(() => {
    if (renameWasPending.current && !renamePending && !renameState.error) setMode("idle");
    renameWasPending.current = renamePending;
  }, [renamePending, renameState.error]);

  const error = renameState.error ?? deleteState.error;

  return (
    <div className="mt-auto pt-4">
      {mode === "rename" && (
        <form action={renameAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="sr-only" htmlFor={`rename-${projectId}`}>
            Page name
          </label>
          <input
            id={`rename-${projectId}`}
            name="name"
            defaultValue={projectName}
            maxLength={80}
            autoFocus
            className="h-amb-control min-w-0 flex-1 rounded-amb-control border border-amb-input bg-amb-card px-2.5 text-[14px] text-amb-foreground focus:border-amb-ring focus:outline-none"
          />
          <button type="submit" disabled={renamePending} className={GHOST_BUTTON}>
            {renamePending ? "Saving" : "Save"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className={GHOST_BUTTON}>
            Cancel
          </button>
        </form>
      )}

      {mode === "delete" && (
        <form action={deleteAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <span className="mr-auto text-[13px] text-amb-muted-foreground">
            Delete this page and its versions?
          </span>
          <button
            type="submit"
            disabled={deletePending}
            className="inline-flex h-amb-control items-center rounded-amb-row bg-amb-destructive px-2.5 text-[14px] font-medium text-amb-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {deletePending ? "Deleting" : "Delete"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className={GHOST_BUTTON}>
            Cancel
          </button>
        </form>
      )}

      {mode === "idle" && (
        <div className="flex items-center gap-2">
          <Link href={builderHref} className={GHOST_BUTTON}>
            Open builder
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
          <button
            type="button"
            onClick={() => setMode("rename")}
            aria-label={`Rename ${projectName}`}
            className={`${GHOST_ICON} ml-auto`}
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMode("delete")}
            aria-label={`Delete ${projectName}`}
            className={GHOST_ICON}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[12px] text-amb-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
