import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'views', 'MapOverviewView.vue'), 'utf8')
const svgSource = fs.readFileSync(path.join(here, '..', 'components', 'map-overview', 'MapOverviewSvgCanvas.vue'), 'utf8')

describe('Map Overview layout view policy', () => {
  it('uses the deterministic layered grid for incomplete cold-start positions without a hidden graph', () => {
    expect(source).toMatch(/executeMapOverviewLayout\(next, 'layered-grid'/)
    expect(source).toMatch(/runLayout\(next, 'layered-grid', validStored, true\)/)
    expect(source).not.toMatch(/document\.createElement\(['"]div['"]\)/)
  })

  it('keeps the layout selector usable and exposes a stop action while a layout runs', () => {
    expect(source).toMatch(/if \(layoutRunning\.value\) \{\s*cancelActiveLayout\(false\)/)
    expect(source).toMatch(/data-ui-id="map-overview-layout-stop"/)
    expect(source).not.toMatch(/data-ui-id="map-overview-layout"[^>]*:disabled=/)
  })

  it('cancels background layout work when manual movement begins', () => {
    expect(source).toMatch(/function onSvgNodeDragStart[\s\S]*?cancelActiveLayout\(false\)/)
    expect(source).toMatch(/if \(event\.altKey && selectedNodeId\.value != null\) \{\s*cancelActiveLayout\(false\)/)
  })

  it('keeps coordinate-level display edges separate from layout topology', () => {
    expect(svgSource).toMatch(/next\.edges\.flatMap\(edge =>/)
    expect(svgSource).toMatch(/mapOverviewSvgEdgeGeometry\(edge, geometryNodeMap\.value/)
    expect(svgSource).toMatch(/mapOverviewSvgPortPoint\(node, x, y\)/)
  })

  it('uses the SVG renderer and contains no G6 runtime boundary', () => {
    expect(source).toMatch(/<MapOverviewSvgCanvas/)
    expect(source).not.toMatch(/@antv\/g6/)
    expect(svgSource).toMatch(/from 'd3-(selection|drag|zoom)'/)
    expect(svgSource).toMatch(/class="map-overview-svg-edge-hit"/)
    expect(svgSource).toMatch(/updateIncidentGeometry\(mapId\)/)
    expect(svgSource).not.toMatch(/renderVersion\.value \+= 1[\s\S]{0,120}updateIncidentGeometry/)
  })

  it('keeps thin visual edges, wide transparent hit targets, and graded interaction emphasis', () => {
    expect(svgSource).toMatch(/map-overview-svg-edge \{[^}]*stroke-width:1;/)
    expect(svgSource).toMatch(/map-overview-svg-edge-hit \{[^}]*stroke-width:13;/)
    expect(svgSource).toMatch(/node-selected \{ stroke-width:1\.5;/)
    expect(svgSource).toMatch(/edge-selected \{ stroke-width:2\.5;/)
    expect(svgSource).toMatch(/map-overview-svg-low-detail/)
  })
})
