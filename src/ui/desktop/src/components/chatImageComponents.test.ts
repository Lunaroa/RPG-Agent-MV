import { describe, expect, it } from 'vitest'

import ChatComposer from './ChatComposer.vue'
import TurnSegment from './TurnSegment.vue'
import ChatView from '../views/ChatView.vue'

describe('chat image component modules', () => {
  it('compile with the image composer and transcript bindings', () => {
    expect(ChatComposer).toBeTruthy()
    expect(TurnSegment).toBeTruthy()
    expect(ChatView).toBeTruthy()
  })
})
