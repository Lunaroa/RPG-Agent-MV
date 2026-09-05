/**
 * Shared title-bar drag for all modal dialogs in the desktop app.
 *
 * Covers both dialog systems with one global listener, so individual
 * components do not wire their own move logic:
 * - self-made `.editor-modal-overlay > .editor-modal-shell` dialogs
 *   (styles/editor-dialog.css), where the overlay is a centered flexbox and
 *   the offset is applied as margins — composing with per-dialog resize
 *   logic that only changes width/height;
 * - Element Plus `.el-dialog` instances, where the default layout is
 *   `margin: <top> auto 50px` — the offset is applied as a translate so the
 *   auto-margin centering stays intact. Dialogs already positioned by their
 *   own state (style position/left/top, e.g. the resource workspace) are
 *   skipped.
 */

import { appTitlebarHeight } from './appTitlebar';

const OVERLAY_SELECTOR = '.editor-modal-overlay';
const SHELL_SELECTOR = '.editor-modal-shell';
const HEADER_SELECTOR = '.editor-modal-header';
const EL_DIALOG_SELECTOR = '.el-dialog';
const EL_HEADER_SELECTOR = '.el-dialog__header';
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [contenteditable]';
const DRAG_THRESHOLD = 3;
/** Keep at least this much of the shell reachable inside the viewport. */
const VISIBLE_EDGE_PX = 48;

interface DragState {
  pointerId: number;
  shell: HTMLElement;
  lastClientX: number;
  lastClientY: number;
  baseLeft: number;
  baseTop: number;
  offsetX: number;
  offsetY: number;
  mode: 'margin' | 'translate';
  moved: boolean;
}

let dragState: DragState | null = null;
let installed = false;

export function installEditorModalDrag(doc: Document = document): () => void {
  if (installed) return () => undefined;
  const view = doc.defaultView;
  if (!view) {
    return () => undefined;
  }
  installed = true;
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('pointermove', onPointerMove, true);
  doc.addEventListener('pointerup', onPointerEnd, true);
  doc.addEventListener('pointercancel', onPointerEnd, true);
  return () => {
    installed = false;
    dragState = null;
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('pointermove', onPointerMove, true);
    doc.removeEventListener('pointerup', onPointerEnd, true);
    doc.removeEventListener('pointercancel', onPointerEnd, true);
  };
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || dragState) return;
  const target = event.target as Element | null;
  if (!target?.closest) return;
  if (target.closest(INTERACTIVE_SELECTOR)) return;
  const editorHeader = target.closest(HEADER_SELECTOR);
  if (editorHeader) {
    const shell = editorHeader.closest(SHELL_SELECTOR) as HTMLElement | null;
    if (!shell || !shell.closest(OVERLAY_SELECTOR)) return;
    // Shells with their own title-bar drag write a transform on the shell.
    if (shell.style.transform) return;
    beginDrag(event, shell, 'margin');
    return;
  }
  const elHeader = target.closest(EL_HEADER_SELECTOR);
  if (!elHeader) return;
  const dialog = elHeader.closest(EL_DIALOG_SELECTOR) as HTMLElement | null;
  if (!dialog) return;
  if (dialog.closest('.el-overlay')?.classList.contains('el-message-box__wrapper')) return;
  // Dialogs with their own position state manage left/top themselves.
  if (dialog.style.position || dialog.style.left || dialog.style.top || dialog.style.transform) return;
  beginDrag(event, dialog, 'translate');
}

function beginDrag(event: PointerEvent, shell: HTMLElement, mode: DragState['mode']): void {
  const rect = shell.getBoundingClientRect();
  const marginLeft = parseFloat(shell.style.marginLeft) || 0;
  const marginTop = parseFloat(shell.style.marginTop) || 0;
  dragState = {
    pointerId: event.pointerId,
    shell,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    // Layout position without any drag offset, captured once per drag.
    baseLeft: mode === 'margin' ? rect.left - marginLeft : rect.left,
    baseTop: mode === 'margin' ? rect.top - marginTop : rect.top,
    offsetX: mode === 'margin' ? marginLeft : 0,
    offsetY: mode === 'margin' ? marginTop : 0,
    mode,
    moved: false,
  };
  event.preventDefault();
}

function onPointerMove(event: PointerEvent): void {
  const state = dragState;
  if (!state || event.pointerId !== state.pointerId) return;
  const dx = event.clientX - state.lastClientX;
  const dy = event.clientY - state.lastClientY;
  if (!state.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
  state.moved = true;
  state.shell.classList.add('editor-modal-shell-dragging');
  state.offsetX += dx;
  state.offsetY += dy;
  state.lastClientX = event.clientX;
  state.lastClientY = event.clientY;
  applyOffset(state);
  event.preventDefault();
}

function onPointerEnd(event: PointerEvent): void {
  const state = dragState;
  if (!state || event.pointerId !== state.pointerId) return;
  state.shell.classList.remove('editor-modal-shell-dragging');
  dragState = null;
}

function applyOffset(state: DragState): void {
  const rect = state.shell.getBoundingClientRect();
  const view = state.shell.ownerDocument.defaultView;
  const viewportWidth = view?.innerWidth ?? rect.width;
  const viewportHeight = view?.innerHeight ?? rect.height;
  // Clamp the would-be position (layout base captured at drag start plus the
  // accumulated offset) against the viewport.
  const nextLeft = state.baseLeft + state.offsetX;
  const nextTop = state.baseTop + state.offsetY;
  const minLeft = VISIBLE_EDGE_PX - rect.width;
  const maxLeft = viewportWidth - VISIBLE_EDGE_PX;
  const minTop = appTitlebarHeight();
  const maxTop = viewportHeight - VISIBLE_EDGE_PX;
  if (nextLeft < minLeft) state.offsetX += minLeft - nextLeft;
  if (nextLeft > maxLeft) state.offsetX -= nextLeft - maxLeft;
  if (nextTop < minTop) state.offsetY += minTop - nextTop;
  if (nextTop > maxTop) state.offsetY -= nextTop - maxTop;
  if (state.mode === 'margin') {
    state.shell.style.marginLeft = `${Math.round(state.offsetX)}px`;
    state.shell.style.marginTop = `${Math.round(state.offsetY)}px`;
  } else {
    state.shell.style.transform = `translate(${Math.round(state.offsetX)}px, ${Math.round(state.offsetY)}px)`;
  }
}
