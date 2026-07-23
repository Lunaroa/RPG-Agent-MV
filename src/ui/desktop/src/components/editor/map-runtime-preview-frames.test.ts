import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const previewSource = readFileSync(new URL('./MapRuntimePreview.vue', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('../../views/EditorView.vue', import.meta.url), 'utf8');

test('hosts the isolated runtime directly instead of copying map frames through the editor', () => {
  assert.match(previewSource, /<iframe/);
  assert.match(previewSource, /sandbox="allow-scripts allow-same-origin"/);
  assert.match(previewSource, /:src="iframeUrl"/);
  assert.match(previewSource, /pointer-events:none/);
  assert.doesNotMatch(previewSource, /<canvas|RTCPeerConnection|createImageBitmap|ackFrame|WebCodecs|MediaStreamTrackProcessor/);
  assert.doesNotMatch(editorSource, /\bonFrame\(|\bonRtcSignal\(|\bonRtcGeneration\(/);
});

test('accepts runtime events only from the mounted preview frame and forwards authenticated payloads', () => {
  assert.match(previewSource, /event\.source !== iframeRef\.value\.contentWindow/);
  assert.match(previewSource, /event\.data\.phase === 'ready'/);
  assert.match(previewSource, /emit\('runtime-event', event\.data\)/);
  assert.match(previewSource, /typeof event\.channelToken === 'string'/);
  assert.match(previewSource, /contentWindow\.postMessage\(command, '\*'\)/);
  assert.match(editorSource, /mapPreview\.runtimeEvent\(event\)/);
  assert.match(editorSource, /event\.sessionId !== session\.sessionId/);
  assert.match(editorSource, /event\.operationId !== session\.operationId/);
  assert.doesNotMatch(editorSource, /mode\.value !== 'preview' \|\| !session/);
});

test('keeps the runtime laid out during startup while covering incomplete content', () => {
  assert.match(previewSource, /const runtimeReady = ref\(false\)/);
  assert.match(previewSource, /\[props\.iframeUrl, props\.operationId, props\.mapRevision, props\.presentationEpoch\]/);
  assert.match(previewSource, /runtimeReady\.value = false/);
  assert.match(previewSource, /runtimeReady\.value = true/);
  assert.match(previewSource, /\['running', 'resuming', 'suspended'\]\.includes\(props\.status\)/);
  assert.match(previewSource, /v-show="!error && Boolean\(iframeUrl\)"/);
  assert.doesNotMatch(previewSource, /v-show="!error && hasDisplayablePreview"/);
  assert.match(previewSource, /\.preview-loading\{position:absolute;inset:0/);
  assert.match(editorSource, /previewPresentationEpoch\.value \+= 1/);
});

test('shows the native runtime FPS and a dedicated refresh loading label', () => {
  assert.match(previewSource, /FPS \{\{ actualFps \?\? '--' \}\}/);
  assert.doesNotMatch(previewSource, /· PNG|png-compat/);
  assert.match(previewSource, /refreshing\?: boolean/);
  assert.match(previewSource, /if \(props\.refreshing\) return t\('editor\.preview\.refreshing'\)/);
  assert.match(editorSource, /:refreshing="previewRefreshActive"/);
  assert.match(editorSource, /forceReload: true/);
});

test('shows authoritative loading stages, determinate progress, and elapsed time', () => {
  assert.match(previewSource, /loadProgress\?: MapPreviewLoadProgress/);
  assert.match(previewSource, /role="progressbar"/);
  assert.match(previewSource, /:aria-valuenow="progressPercent"/);
  assert.match(previewSource, /mapPreviewProgressRatio\(props\.loadProgress\)/);
  assert.match(previewSource, /editor\.preview\.progress\.copying/);
  assert.match(previewSource, /editor\.preview\.elapsed/);
  assert.match(editorSource, /:load-progress="previewSession\?\.loadProgress"/);
  assert.match(editorSource, /:started-at="previewSession\?\.startedAt"/);
});
