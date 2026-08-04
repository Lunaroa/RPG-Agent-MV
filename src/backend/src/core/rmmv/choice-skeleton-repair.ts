/**
 * Silent repair for corrupted Show Choices skeletons in event page lists.
 *
 * A Show Choices head (102) must be followed by one When Choice (402) branch
 * per choice, an optional When Cancel (403), and the End Choices (404)
 * terminator. Some write paths (raw list saves that bypass the structured
 * compiler) produced pages where a 402 branch — typically the first one — is
 * missing, which leaves that choice's body dangling at runtime and renders as
 * a missing row in every command preview. The command validator treats branch
 * codes as optional, so the corruption was never rejected.
 *
 * Repair policy: insert only the missing 402 rows at their canonical position
 * (sorted by choice index, before 403/404). Existing rows, branch bodies, and
 * indents are never reordered or rewritten.
 */

interface RawListCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

function isCommand(value: unknown): value is RawListCommand {
  return !!value && typeof value === "object"
    && Number.isInteger((value as RawListCommand).code)
    && Number.isInteger((value as RawListCommand).indent)
    && Array.isArray((value as RawListCommand).parameters);
}

function choiceTexts(head: RawListCommand): string[] {
  const choices = head.parameters[0];
  if (!Array.isArray(choices)) return [];
  return choices.map((choice) => String(choice ?? ""));
}

/**
 * Repair one command list in place. Returns true when rows were inserted.
 */
export function repairChoiceSkeletonInList(list: unknown[]): boolean {
  if (!Array.isArray(list)) return false;
  let changed = false;
  for (let i = 0; i < list.length; i += 1) {
    const head = list[i];
    if (!isCommand(head) || head.code !== 102) continue;
    const choices = choiceTexts(head);
    if (!choices.length) continue;

    // Locate the structural rows of this choice block at the head's indent.
    const branchPositions: Array<{ index: number; position: number }> = [];
    let cancelPosition = -1;
    let endPosition = -1;
    let blockEnd = list.length;
    for (let j = i + 1; j < list.length; j += 1) {
      const row = list[j];
      if (!isCommand(row)) continue;
      if (row.indent < head.indent) { blockEnd = j; break; }
      if (row.indent !== head.indent) continue;
      if (row.code === 402 && Number.isInteger(row.parameters[0])) {
        // Rows after the terminator belong to the next block, never to this one.
        if (endPosition >= 0) continue;
        branchPositions.push({ index: Number(row.parameters[0]), position: j });
      } else if (row.code === 403 && cancelPosition < 0 && endPosition < 0) {
        cancelPosition = j;
      } else if (row.code === 404 && endPosition < 0) {
        endPosition = j;
        blockEnd = j;
        break;
      }
    }
    // Anchoring assumes index order; sort so out-of-order rows still resolve
    // to the correct neighbor branch.
    branchPositions.sort((left, right) => left.index - right.index);

    const present = new Set(branchPositions.map((branch) => branch.index));
    const insertions: Array<{ row: RawListCommand; before: number }> = [];
    for (let m = 0; m < choices.length; m += 1) {
      if (present.has(m)) continue;
      const after = branchPositions.filter((branch) => branch.index < m).length;
      let anchor = branchPositions[after]?.position ?? (cancelPosition >= 0 ? cancelPosition : endPosition);
      if (anchor < 0) continue; // Block is too broken to repair safely.
      // Never insert past the cancel branch or terminator.
      const cap = cancelPosition >= 0 ? cancelPosition : endPosition;
      if (cap >= 0) anchor = Math.min(anchor, cap);
      insertions.push({
        row: { code: 402, indent: head.indent, parameters: [m, choices[m]] },
        before: anchor,
      });
    }
    if (!insertions.length) continue;
    // Insert from the tail so earlier positions stay valid. Tie-break by
    // choice index descending: splicing several rows at the same anchor keeps
    // them in ascending choice order.
    insertions.sort(
      (left, right) => right.before - left.before
        || Number(right.row.parameters[0]) - Number(left.row.parameters[0]),
    );
    for (const insertion of insertions) list.splice(insertion.before, 0, insertion.row);
    changed = true;
    i += insertions.length;
  }
  return changed;
}

interface RepairableEventLike {
  pages?: unknown;
}

/**
 * Repair every page list of an events array (Map.json `events` shape).
 * Returns the repaired events (same array instance; lists are edited in
 * place) plus whether anything changed.
 */
export function repairMapEventChoiceSkeletons(events: unknown[]): { events: unknown[]; changed: boolean } {
  let changed = false;
  for (const entry of events) {
    const event = entry as RepairableEventLike | null;
    if (!event || typeof event !== "object" || !Array.isArray(event.pages)) continue;
    for (const page of event.pages as Array<{ list?: unknown } | null>) {
      if (!page || typeof page !== "object" || !Array.isArray(page.list)) continue;
      if (repairChoiceSkeletonInList(page.list)) changed = true;
    }
  }
  return { events, changed };
}
