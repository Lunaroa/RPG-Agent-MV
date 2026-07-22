export interface MapOverviewNodePosition {
  x: number
  y: number
}

export interface MapOverviewMove {
  nodeId: string
  before: MapOverviewNodePosition
  after: MapOverviewNodePosition
}

export class MapOverviewMoveHistory {
  private readonly undoStack: MapOverviewMove[] = []
  private readonly redoStack: MapOverviewMove[] = []
  private readonly limit: number

  constructor(limit = 100) {
    this.limit = limit
  }

  record(move: MapOverviewMove): boolean {
    if (samePosition(move.before, move.after)) return false
    this.undoStack.push(cloneMove(move))
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit)
    this.redoStack.length = 0
    return true
  }

  undo(): MapOverviewMove | null {
    const move = this.undoStack.pop()
    if (!move) return null
    this.redoStack.push(move)
    return cloneMove(move)
  }

  redo(): MapOverviewMove | null {
    const move = this.redoStack.pop()
    if (!move) return null
    this.undoStack.push(move)
    return cloneMove(move)
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
}

function samePosition(left: MapOverviewNodePosition, right: MapOverviewNodePosition): boolean {
  return left.x === right.x && left.y === right.y
}

function cloneMove(move: MapOverviewMove): MapOverviewMove {
  return {
    nodeId: move.nodeId,
    before: { ...move.before },
    after: { ...move.after },
  }
}
