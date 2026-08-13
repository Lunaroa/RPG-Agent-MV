import type { UiDesignerDocument, UiNode } from '@contract/ui-designer'

const CASCADE_START = 24
const CASCADE_STEP = 24
const CASCADE_SLOTS = 10

export const nextSiblingCascadePosition = (
  document: UiDesignerDocument,
  node: Pick<UiNode, 'parentId' | 'props'>,
) => {
  const siblings = document.nodes.filter((candidate) => candidate.parentId === node.parentId)
  const slot = siblings.length % CASCADE_SLOTS
  const desired = CASCADE_START + slot * CASCADE_STEP
  const parent = node.parentId ? document.nodes.find((candidate) => candidate.id === node.parentId) : undefined
  const parentWidth = parent ? Math.abs(parent.props.width * parent.props.scaleX) : document.canvas.width
  const parentHeight = parent ? Math.abs(parent.props.height * parent.props.scaleY) : document.canvas.height
  const parentLeft = parent ? parent.props.x - parentWidth * parent.props.anchorX : 0
  const parentTop = parent ? parent.props.y - parentHeight * parent.props.anchorY : 0
  return {
    x: parentLeft + Math.min(desired, Math.max(0, parentWidth - node.props.width)),
    y: parentTop + Math.min(desired, Math.max(0, parentHeight - node.props.height)),
  }
}
