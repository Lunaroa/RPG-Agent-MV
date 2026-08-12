import type { UiDesignerDocument, UiHistoryEntry, UiHistorySnapshot } from '@contract/ui-designer'
import { cloneUiDocument } from './document'
import { normalizeDocumentGeometry } from './geometry'

interface HistoryPoint {
  document: UiDesignerDocument
  serialized: string
  entry?: UiHistoryEntry
}

export class UiDesignerHistory {
  private points: HistoryPoint[]
  private cursor = 0
  private savedCursor = 0
  private savedDocument: UiDesignerDocument
  private sequence = 0
  private maxSteps: number

  constructor(initial: UiDesignerDocument, maxSteps = 100) {
    this.maxSteps = Math.max(1, Math.floor(maxSteps))
    const normalized = normalizeDocumentGeometry(initial)
    this.points = [{ document: normalized, serialized: JSON.stringify(normalized) }]
    this.savedDocument = normalized
  }

  get current(): UiDesignerDocument {
    return cloneUiDocument(this.points[this.cursor].document)
  }

  get canUndo(): boolean {
    return this.cursor > 0
  }

  get canRedo(): boolean {
    return this.cursor < this.points.length - 1
  }

  get availableUndoSteps(): number {
    return this.cursor
  }

  get availableRedoSteps(): number {
    return this.points.length - this.cursor - 1
  }

  setMaxSteps(maxSteps: number): void {
    this.maxSteps = Math.max(1, Math.floor(maxSteps))
    while (this.points.length > this.maxSteps + 1) {
      this.points.shift()
      this.cursor -= 1
      this.savedCursor -= 1
    }
    this.cursor = Math.max(0, this.cursor)
    this.savedCursor = Math.max(-1, this.savedCursor)
  }

  get isDirty(): boolean {
    return this.savedCursor !== this.cursor
  }

  commit(document: UiDesignerDocument, description: string): UiDesignerDocument {
    return this.commitCanonical(normalizeDocumentGeometry(document), description)
  }

  /** Accepts a detached canonical document and adopts it as the next history point. */
  commitOwned(document: UiDesignerDocument, description: string): UiDesignerDocument {
    return this.commitCanonical(document, description)
  }

  private commitCanonical(next: UiDesignerDocument, description: string): UiDesignerDocument {
    const serialized = JSON.stringify(next)
    if (serialized === this.points[this.cursor].serialized) return this.points[this.cursor].document
    if (this.savedCursor > this.cursor) this.savedCursor = -1
    this.points = this.points.slice(0, this.cursor + 1)
    this.points.push({
      document: next,
      serialized,
      entry: { id: `history_${++this.sequence}`, description, timestamp: Date.now() },
    })
    this.cursor = this.points.length - 1
    while (this.points.length > this.maxSteps + 1) {
      this.points.shift()
      this.cursor -= 1
      this.savedCursor -= 1
    }
    if (this.savedCursor < 0) this.savedCursor = -1
    return next
  }

  undo(): UiDesignerDocument {
    if (this.canUndo) this.cursor -= 1
    return this.points[this.cursor].document
  }

  redo(): UiDesignerDocument {
    if (this.canRedo) this.cursor += 1
    return this.points[this.cursor].document
  }

  markSaved(): void {
    this.savedCursor = this.cursor
    this.savedDocument = this.points[this.cursor].document
  }

  /** Revert the working document to the last explicitly saved baseline. */
  discard(): UiDesignerDocument {
    this.points = [{ document: this.savedDocument, serialized: JSON.stringify(this.savedDocument) }]
    this.cursor = 0
    this.savedCursor = 0
    return this.savedDocument
  }

  entries(): UiHistoryEntry[] {
    return this.points.slice(1).map((point) => ({ ...point.entry! }))
  }

  snapshot(): UiHistorySnapshot {
    return {
      document: this.current,
      entries: this.entries(),
      index: this.cursor,
      savedIndex: this.savedCursor,
    }
  }
}
