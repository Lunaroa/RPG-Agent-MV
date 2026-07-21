/**
 * Run: node --experimental-strip-types --test src/utils/conversationGroups.test.ts
 * (from RPG-Agent-MV/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  activeConversationRootId,
  groupSessionsIntoConversations,
  nearestConversationAfterDeletion,
  sessionIdsForConversations,
  titleForSession,
} from './conversationGroups.ts'
import type { Session } from '../composables/useSession.ts'

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    status: 'pass',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    ...overrides,
  } as Session
}

describe('groupSessionsIntoConversations', () => {
  test('groups parent and child sessions into one conversation', () => {
    const sessions = [
      session('root-1', { displayText: 'Root chat', updatedAt: '2026-06-01T10:00:00.000Z' }),
      session('child-1', { parentSessionId: 'root-1', updatedAt: '2026-06-02T12:00:00.000Z' }),
      session('root-2', { displayText: 'Other chat', updatedAt: '2026-06-03T08:00:00.000Z' }),
    ]

    const conversations = groupSessionsIntoConversations(sessions)

    assert.equal(conversations.length, 2)
    assert.equal(conversations[0].rootId, 'root-2')
    assert.equal(conversations[1].rootId, 'root-1')
    assert.equal(conversations[1].leafId, 'child-1')
    assert.deepEqual(conversations[1].sessionIds, ['root-1', 'child-1'])
    assert.equal(conversations[1].title, 'Root chat')
  })

  test('prefers root intent when displayText is generic ask ack', () => {
    const sessions = [
      session('root-1', {
        intent: 'Add a sample side quest',
        displayText: '大纲已确认',
        updatedAt: '2026-06-01T10:00:00.000Z',
      }),
      session('child-1', { parentSessionId: 'root-1', displayText: '大纲已确认', updatedAt: '2026-06-02T12:00:00.000Z' }),
    ]
    const conversations = groupSessionsIntoConversations(sessions)
    assert.equal(conversations[0].title, 'Add a sample side quest')
  })

  test('keeps the root project while sorting by the latest leaf update', () => {
    const sessions = [
      session('project-a', { project: 'projects/Alpha', displayText: 'Alpha', updatedAt: '2026-06-01T10:00:00.000Z' }),
      session('project-a-child', {
        parentSessionId: 'project-a',
        project: 'projects/Alpha',
        updatedAt: '2026-06-04T10:00:00.000Z',
      }),
      session('project-b', { project: 'projects/Beta', displayText: 'Beta', updatedAt: '2026-06-03T10:00:00.000Z' }),
    ]

    const conversations = groupSessionsIntoConversations(sessions)

    assert.equal(conversations[0].rootId, 'project-a')
    assert.equal(conversations[0].project, 'projects/Alpha')
    assert.equal(conversations[1].project, 'projects/Beta')
  })

  test('uses English fallback titles in English mode', () => {
    const conversations = groupSessionsIntoConversations([session('empty', { intent: '', displayText: '' })], 'en-US')

    assert.equal(conversations[0].title, '(Untitled)')
    assert.equal(titleForSession([], null, 'en-US'), 'New conversation')
  })

  test('protects a whole conversation while any turn is not terminal', () => {
    const conversations = groupSessionsIntoConversations([
      session('finished-root', { status: 'pass' }),
      session('waiting-turn', { status: 'running', parentSessionId: 'finished-root' }),
      session('finished-other', { status: 'timeout' }),
    ])

    assert.equal(conversations.find((conversation) => conversation.rootId === 'finished-root')?.batchDeletable, false)
    assert.equal(conversations.find((conversation) => conversation.rootId === 'finished-other')?.batchDeletable, true)
  })

  test('deduplicates internal session ids and finds the nearest remaining conversation', () => {
    const conversations = groupSessionsIntoConversations([
      session('newest', { updatedAt: '2026-06-03T10:00:00.000Z' }),
      session('middle', { updatedAt: '2026-06-02T10:00:00.000Z' }),
      session('oldest', { updatedAt: '2026-06-01T10:00:00.000Z' }),
    ])
    const duplicate = { ...conversations[0], sessionIds: ['newest', 'newest'] }

    assert.deepEqual(sessionIdsForConversations([duplicate, conversations[1]]), ['newest', 'middle'])
    assert.equal(
      nearestConversationAfterDeletion(conversations, new Set(['newest', 'middle']), 'newest')?.rootId,
      'oldest',
    )
    assert.equal(
      nearestConversationAfterDeletion(conversations, new Set(['middle', 'oldest']), 'middle')?.rootId,
      'newest',
    )
  })
})

describe('activeConversationRootId', () => {
  test('returns root id for a child session', () => {
    const sessions = [
      session('root-1'),
      session('child-1', { parentSessionId: 'root-1' }),
    ]

    assert.equal(activeConversationRootId(sessions, 'child-1'), 'root-1')
  })
})
