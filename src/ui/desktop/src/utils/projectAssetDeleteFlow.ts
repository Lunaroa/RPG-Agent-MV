/** Pure confirmation planning for project-asset delete (blocked-by-references vs explicit force delete). */

import type {
  ProjectAssetBrowseEntry,
  ProjectAssetMutationSafetyCheck,
} from '@contract/types';

/** Cap reference sources shown per item and referenced items listed, so the dialog stays readable. */
export const DELETE_CONFIRM_MAX_SOURCES_PER_ITEM = 5;
export const DELETE_CONFIRM_MAX_REFERENCED_ITEMS = 10;

export interface ProjectAssetDeleteConfirmCopy {
  confirmSingle(name: string): string;
  confirmBatchMany(count: number, referenced: number): string;
  forceIntro(referencesText: string): string;
  forceReferenceItem(name: string, sources: string): string;
  forceOverflow(count: number): string;
  forceButton: string;
}

export interface ProjectAssetDeleteConfirmationPlan {
  message: string;
  /** Explicit button label for the force path; undefined keeps the default confirm button. */
  confirmButtonText?: string;
  force: boolean;
}

function referenceSourcesText(
  check: ProjectAssetMutationSafetyCheck,
  copy: ProjectAssetDeleteConfirmCopy,
): string {
  const sources = check.references
    .map((reference) => reference.source)
    .filter((source) => Boolean(source));
  const shown = sources.slice(0, DELETE_CONFIRM_MAX_SOURCES_PER_ITEM);
  const rest = sources.length - shown.length;
  const parts = [shown.join(', ')];
  if (rest > 0) parts.push(copy.forceOverflow(rest));
  return parts.filter(Boolean).join(' ');
}

/**
 * Decide what the delete confirmation looks like.
 * No known references: keep the single-step confirm, delete runs with force=false.
 * Any known references: list them explicitly and require the explicit "delete anyway"
 * button; the batch then runs with force=true.
 */
export function planProjectAssetDeleteConfirmation(
  entries: readonly ProjectAssetBrowseEntry[],
  safetyResults: readonly ProjectAssetMutationSafetyCheck[],
  copy: ProjectAssetDeleteConfirmCopy,
): ProjectAssetDeleteConfirmationPlan {
  const referenced = safetyResults.filter((item) => item.references.length > 0);
  if (referenced.length === 0) {
    const message = entries.length === 1
      ? copy.confirmSingle(entries[0]!.name)
      : copy.confirmBatchMany(entries.length, 0);
    return { message, force: false };
  }
  const shownItems = referenced.slice(0, DELETE_CONFIRM_MAX_REFERENCED_ITEMS);
  const lines = shownItems.map((check) => {
    const name = check.target.name || '—';
    return copy.forceReferenceItem(name, referenceSourcesText(check, copy));
  });
  const hiddenItems = referenced.length - shownItems.length;
  if (hiddenItems > 0) lines.push(copy.forceOverflow(hiddenItems));
  return {
    message: copy.forceIntro(lines.join('\n')),
    confirmButtonText: copy.forceButton,
    force: true,
  };
}
