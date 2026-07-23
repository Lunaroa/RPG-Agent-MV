import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'views', 'MapOverviewView.vue'), 'utf8')
const svgSource = fs.readFileSync(path.join(here, '..', 'components', 'map-overview', 'MapOverviewSvgCanvas.vue'), 'utf8')
const workerSource = fs.readFileSync(path.join(here, '..', 'workers', 'mapOverviewLayout.worker.ts'), 'utf8')

describe('Map Overview layout view policy', () => {
  it('compiles the map overview view', () => {
    const parsed = parse(source, { filename: 'MapOverviewView.vue' })
    expect(parsed.errors).toEqual([])
    compileScript(parsed.descriptor, { id: 'map-overview-view' })
    const template = compileTemplate({
      id: 'map-overview-view',
      filename: 'MapOverviewView.vue',
      source: parsed.descriptor.template?.content || '',
    })
    expect(template.errors).toEqual([])
  })

  it('compiles the SVG canvas component', () => {
    const parsed = parse(svgSource, { filename: 'MapOverviewSvgCanvas.vue' })
    expect(parsed.errors).toEqual([])
    compileScript(parsed.descriptor, { id: 'map-overview-svg-canvas' })
    const template = compileTemplate({
      id: 'map-overview-svg-canvas',
      filename: 'MapOverviewSvgCanvas.vue',
      source: parsed.descriptor.template?.content || '',
    })
    expect(template.errors).toEqual([])
  })

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

  it('validates layout parameter drafts before work and validates the worker protocol again', () => {
    expect(source).toMatch(/parseMapOverviewLayoutParameters\(selectedLayoutId\.value, layoutParameterDraft\.value\)/)
    expect(source).toMatch(/data-ui-id="map-overview-layout-parameters-apply"/)
    expect(source).toMatch(/patchMapOverviewLayoutParameters/)
    expect(workerSource).toMatch(/parseMapOverviewLayoutParameters\(request\.layoutId, request\.parameters\)/)
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
    expect(svgSource).toMatch(/scheduleIncidentGeometry\(mapId\)/)
    expect(svgSource).toMatch(/incidentEdgesByMap\.get\(mapId\)/)
    expect(svgSource).toMatch(/buildMapOverviewIncidentEdgeIndex\(next\.edges\)/)
    expect(svgSource).not.toMatch(/renderVersion\.value \+= 1[\s\S]{0,120}updateIncidentGeometry/)
  })

  it('keeps node dragging separate from middle-button and space panning', () => {
    expect(svgSource).toMatch(/shouldStartMapOverviewNodeDrag/)
    expect(svgSource).toMatch(/shouldStartMapOverviewPan/)
    expect(svgSource).toMatch(/isMapOverviewNodeDragAllowed/)
    expect(svgSource).toMatch(/'drag-locked': nodeDragLocked\(node\.id\)/)
    expect(svgSource).toMatch(/event\.code !== 'Space'/)
    expect(svgSource).toMatch(/gestureState\.value !== 'idle'/)
    expect(svgSource).toMatch(/@auxclick\.prevent/)
  })

  it('synchronizes declarative geometry before committing a completed drag', () => {
    expect(svgSource).toMatch(/renderVersion\.value \+= 1[\s\S]{0,180}emit\('nodeDragEnd'/)
  })

  it('keeps the graph usable when individual thumbnails fail and supports an in-place retry', () => {
    expect(source).toMatch(/failures\.set\(node\.id, formatThumbnailFailure\(error\)\)/)
    expect(source).toMatch(/thumbnailProgressCompleted\.value \+= 1/)
    expect(source).not.toMatch(/if \(failures\.length\)[\s\S]{0,240}throw new Error/)
    expect(source).toMatch(/await graph\?\.setThumbnailState\(mapId, image\.src, null\)/)
    expect(source).toMatch(/data-ui-id="map-overview-thumbnail-retry"/)
    expect(source).toMatch(/thumbnailFailures\.value\.size[\s\S]{0,160}mapOverview\.export\.thumbnailFailures/)
    expect(svgSource).toMatch(/class="map-overview-svg-node-placeholder"/)
    expect(svgSource).toMatch(/'thumbnail-failed': Boolean\(thumbnailError\(node\.id\)\)/)
    expect(svgSource).toMatch(/:aria-label="nodeAriaLabel\(node\)"/)
  })

  it('uses compact labels and exposes transfer coordinates in the inspector', () => {
    expect(svgSource).toMatch(/node\.imageHeight \/ 2 \+ 6/)
    expect(svgSource).toMatch(/height="20"/)
    expect(svgSource).toMatch(/font:600 12px/)
    expect(svgSource).toMatch(/port\.label\.width/)
    expect(svgSource).toMatch(/font:600 9px/)
    expect(svgSource).toMatch(/placeMapOverviewPortLabels/)
    expect(svgSource).toMatch(/map-overview-svg-port-label-leader/)
    expect(source).toMatch(/edge\.sourceX/)
    expect(source).toMatch(/edge\.targetX/)
    expect(source).toMatch(/:disabled="!canOpenMap\(selectedNode\.id\)"/)
  })

  it('uses shared transfer-condition visuals and readable inspector details', () => {
    expect(svgSource).toMatch(/classifyMapOverviewEdgeConditions\(edge\.sources\)/)
    expect(svgSource).toMatch(/mapOverviewTransferConditionVisual\(category\)/)
    expect(svgSource).toMatch(/:aria-label="edgeAriaLabel\(item\.edge, item\.condition\)"/)
    expect(source).toMatch(/summarizeMapOverviewTransferConditions\(pageConditions\)/)
    expect(source).not.toMatch(/JSON\.stringify\(source\.pageConditions\)/)
  })

  it('uses orange foreground relationships while retaining condition dash patterns', () => {
    expect(svgSource).toMatch(/foregroundEdgeVisualStyle/)
    expect(svgSource).toMatch(/stroke: 'var\(--map-overview-active-color\)'/)
    expect(svgSource).toMatch(/visual\.dashArray/)
    expect(svgSource).toMatch(/fill="var\(--map-overview-active-color\)"/)
  })

  it('requires zero overlap only for layered grid and warns after applying other layouts', () => {
    expect(source).toMatch(/if \(layoutId === 'layered-grid'\) \{\s*validateMapOverviewLayoutNoOverlap/)
    expect(source).toMatch(/inspectMapOverviewLayoutOverlaps\(nodeRects, positions\)\.count/)
    expect(source).toMatch(/mapOverview\.layout\.overlapWarning/)
  })

  it('keeps PNG export but removes the completed-file reveal action', () => {
    expect(source).toMatch(/data-ui-id="map-overview-export"/)
    expect(source).not.toMatch(/map-overview-export-reveal/)
    expect(source).not.toMatch(/revealOverviewExport/)
  })

  it('keeps thin visual edges, wide transparent hit targets, and graded interaction emphasis', () => {
    expect(svgSource).toMatch(/map-overview-svg-edge \{[^}]*stroke-width:1;/)
    expect(svgSource).toMatch(/map-overview-svg-edge-hit \{[^}]*stroke-width:13;/)
    expect(svgSource).toMatch(/node-selected \{ stroke-width:1\.5;/)
    expect(svgSource).toMatch(/edge-selected \{ stroke-width:2\.5;/)
    expect(svgSource).toMatch(/map-overview-svg-low-detail/)
  })
})
