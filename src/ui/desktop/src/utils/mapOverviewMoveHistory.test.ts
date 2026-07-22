import { describe, expect, it } from 'vitest'
import { MapOverviewMoveHistory } from './mapOverviewMoveHistory'

describe('MapOverviewMoveHistory', () => {
  it('undoes and redoes multiple moves in order', () => {
    const history = new MapOverviewMoveHistory()
    history.record({ nodeId: '1', before: { x: 0, y: 0 }, after: { x: 10, y: 0 } })
    history.record({ nodeId: '2', before: { x: 5, y: 5 }, after: { x: 8, y: 9 } })

    expect(history.undo()).toMatchObject({ nodeId: '2', before: { x: 5, y: 5 } })
    expect(history.undo()).toMatchObject({ nodeId: '1', before: { x: 0, y: 0 } })
    expect(history.redo()).toMatchObject({ nodeId: '1', after: { x: 10, y: 0 } })
  })

  it('clears redo after a new move and ignores unchanged positions', () => {
    const history = new MapOverviewMoveHistory()
    expect(history.record({ nodeId: '1', before: { x: 0, y: 0 }, after: { x: 0, y: 0 } })).toBe(false)
    history.record({ nodeId: '1', before: { x: 0, y: 0 }, after: { x: 1, y: 0 } })
    history.undo()
    history.record({ nodeId: '1', before: { x: 0, y: 0 }, after: { x: 2, y: 0 } })
    expect(history.redo()).toBeNull()
  })

  it('keeps at most the configured number of moves', () => {
    const history = new MapOverviewMoveHistory(2)
    for (let index = 0; index < 3; index += 1) {
      history.record({ nodeId: '1', before: { x: index, y: 0 }, after: { x: index + 1, y: 0 } })
    }
    expect(history.undo()).not.toBeNull()
    expect(history.undo()).not.toBeNull()
    expect(history.undo()).toBeNull()
  })
})
