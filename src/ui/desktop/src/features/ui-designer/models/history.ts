import type { UiDesignerDocument, UiHistoryEntry, UiHistorySnapshot } from '@contract/ui-designer'
import { cloneUiDocument } from './document'
import { serializeDocument } from './export'
import { normalizeDocumentGeometry } from './geometry'

interface HistoryPoint {
  document: UiDesignerDocument
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
    this.points = [{ document: normalized }]
    this.savedDocument = cloneUiDocument(normalized)
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
    const next = normalizeDocumentGeometry(document)
    if (serializeDocument(next) === serializeDocument(this.points[this.cursor].document)) return this.current
    this.points = this.points.slice(0, this.cursor + 1)
    this.points.push({
      document: next,
      entry: { id: `history_${++this.sequence}`, description, timestamp: Date.now() },
    })
    this.cursor = this.points.length - 1
    while (this.points.length > this.maxSteps + 1) {
      this.points.shift()
      this.cursor -= 1
      this.savedCursor -= 1
    }
    if (this.savedCursor < 0) this.savedCursor = -1
    return this.current
  }

  undo(): UiDesignerDocument {
    if (this.canUndo) this.cursor -= 1
    return this.current
  }

  redo(): UiDesignerDocument {
    if (this.canRedo) this.cursor += 1
    return this.current
  }

  markSaved(): void {
    this.savedCursor = this.cursor
    this.savedDocument = cloneUiDocument(this.points[this.cursor].document)
  }

  /** Revert the working document to the last explicitly saved baseline. */
  discard(): UiDesignerDocument {
    this.points = [{ document: cloneUiDocument(this.savedDocument) }]
    this.cursor = 0
    this.savedCursor = 0
    return this.current
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
