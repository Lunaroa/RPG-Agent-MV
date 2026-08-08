import type { UiDesignerDocument, UiPerformanceReport } from '@contract/ui-designer'

export function analyzePerformance(document: UiDesignerDocument): UiPerformanceReport {
  let particleSystems = 0
  let maxParticleTotal = 0
  let frameCount = 0
  let codeModeProperties = 0
  for (const node of document.nodes) {
    if (node.type === 'particle') {
      particleSystems += 1
      maxParticleTotal += Math.max(0, node.props.maxParticles)
    }
    if (node.type === 'frameAnimation') frameCount += node.props.frames.length
    codeModeProperties += Object.values(node.propModes).filter((mode) => mode === 'code').length
  }
  const suggestions: string[] = []
  if (document.nodes.length >= 50) suggestions.push('Consider merging static background layers to reduce node count.')
  if (particleSystems >= 3 || maxParticleTotal >= 300) suggestions.push('Multiple particle systems may cause dropped frames on low-end devices.')
  if (codeModeProperties > 8) suggestions.push('Code-mode properties are evaluated repeatedly; keep expressions short.')
  if (document.nodes.some((node) => node.events.onUpdate)) suggestions.push('onUpdate actions run every frame and should remain lightweight.')
  const exceedsDocumentedThreshold = document.nodes.length >= 50 || particleSystems >= 3 || maxParticleTotal >= 300
  const rating = exceedsDocumentedThreshold ? 'mayStutter' : 'smooth'
  return {
    nodeCount: document.nodes.length,
    particleSystems,
    maxParticleTotal,
    frameCount,
    codeModeProperties,
    rating,
    suggestions,
  }
}
