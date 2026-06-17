export interface AskChoiceAnswer {
  selected: string[]
  other: string
}

/** 单选题：调整文字存在时优先提交为「其他」，但不要求界面清空正向选择。 */
export function buildSingleSelectMccAnswer(
  selectedId: string,
  otherText: string,
): AskChoiceAnswer | null {
  const id = String(selectedId || '').trim()
  const other = String(otherText || '').trim()
  if (other) return { selected: ['__other__'], other }
  if (!id || id === '__other__') return { selected: [], other: '' }
  return { selected: [id], other: '' }
}

/** 多选题：调整文字存在时优先提交为「其他」，清空后恢复正向多选。 */
export function buildMultiSelectMccAnswer(
  selected: string[],
  otherText: string,
): AskChoiceAnswer | null {
  const other = String(otherText || '').trim()
  if (other) return { selected: ['__other__'], other }
  return { selected: (selected || []).filter((id) => id !== '__other__'), other: '' }
}

/** clarify 单选 + 调整输入：与 multi-choice 单选使用同一提交优先级。 */
export function buildClarifySingleSelectPayload(
  selectedId: string,
  otherText: string,
): { selected: string[]; other: string } | null {
  const built = buildSingleSelectMccAnswer(selectedId, otherText)
  if (!built || !built.selected.length) return null
  return { selected: built.selected, other: built.other }
}
