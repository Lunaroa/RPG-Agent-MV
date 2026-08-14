import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultNode, createUiDocument } from '../models/document'
import { animateFabricNode, applyFabricNodeGeometry, createFabricNodeObject, fabricNodeVisualSignature } from './fabricNodeFactory'
import { mixUiParticleColor, resolveUiParticleFrames, UiParticleObject } from './uiParticleObject'

test('particle object keeps one stable selectable Fabric object while its effect changes', async () => {
  const document = createUiDocument('Scene_Particle')
  const particle = createDefaultNode('particle', { id: 'node_particle_001', name: 'Particle_1', parentId: 'node_root', x: 160, y: 140 })
  document.nodes.push(particle)
  document.nodes[0].children.push(particle.id)
  document.zOrder.push(particle.id)

  const object = await createFabricNodeObject(particle, null, document)
  assert.ok(object instanceof UiParticleObject)
  assert.equal(object.selectable, true)
  assert.equal(object.evented, true)
  assert.equal(object.left, 160)
  assert.equal(object.top, 140)

  const signature = fabricNodeVisualSignature(particle, null)
  particle.props.glow = 12
  particle.props.shape = 'star'
  particle.props.emissionInterval = 6
  applyFabricNodeGeometry(object, particle, document)
  assert.equal(fabricNodeVisualSignature(particle, null), signature)
  assert.equal(animateFabricNode(object, particle, 1500), true)
  assert.equal(object.particleProps, particle.props)
  assert.equal(object.left, 160)
  assert.equal(object.top, 140)
})

test('particle frames stay finite and interpolate color, opacity, scale and motion', () => {
  const particle = createDefaultNode('particle')
  const frames = resolveUiParticleFrames(particle.props, 2500)
  assert.equal(frames.length, 32)
  assert.ok(frames.every((frame) => Object.values(frame).every((value) => typeof value === 'string' || Number.isFinite(value))))
  assert.ok(frames.every((frame) => frame.opacity >= 0 && frame.opacity <= 1 && frame.scale >= 0))
  assert.equal(mixUiParticleColor('#ff0000', '#0000ff00', 0), 'rgba(255, 0, 0, 1)')
  assert.equal(mixUiParticleColor('#ff0000', '#0000ff00', 1), 'rgba(0, 0, 255, 0)')
})
