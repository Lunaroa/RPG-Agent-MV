import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { eventRegistry, placementQueue as placementQueueApi } from '../api/client';
import { useProjectStore } from './project';
import { isPlacedStatus } from '../utils/placementStatus';

export interface StartPlacementSessionOptions {
  sessionId: string;
  contractId?: string;
  project?: string;
}

export interface SyncPlacementAskOptions {
  askId: string;
  sessionId: string;
  project?: string;
}

export interface StartReviewSessionOptions {
  sessionId: string;
  askId?: string;
  project?: string;
}

/** 单条待放置事件（来自 event-placement-list ASK） */
export interface PlacementListEvent {
  contractId: string;
  eventName: string;
  /** 场景 id；仅用于 UI 和注册表语义，不写入地图 note。 */
  sceneId?: string;
  /** Agent 登记时的建议地图（提示用）；实际放置以编辑器当前地图为准。 */
  targetMapId: number | null;
  placementHint?: string;
  summary?: string;
  trigger?: string;
  status?: string;
  placedEventId?: number | null;
  x?: number | null;
  y?: number | null;
}

/** 跨路由：Chat ASK 卡 → 地图编辑器放置事件（对齐 legacy event-placement-flow） */
export interface EventPlacementFocus {
  askId: string;
  sessionId: string;
  contractId: string;
  eventName: string;
  sceneId?: string;
  /** 无值时表示在编辑器当前地图上放置 */
  /** Agent 登记时的建议地图（提示用）；实际放置以编辑器当前地图为准。 */
  targetMapId: number | null;
  placementHint?: string;
  summary?: string;
  trigger?: string;
}

export interface EventPlacementSession {
  askId: string;
  sessionId: string;
  events: PlacementListEvent[];
}

type EventPlacementMode = 'placement' | 'review';

export const useEventPlacementAskStore = defineStore('eventPlacementAsk', () => {
  const projectStore = useProjectStore();
  const activeSession = ref<EventPlacementSession | null>(null);
  const selectedContractId = ref<string | null>(null);
  /** 用户点击「放置」后才会进入地图放置交互 */
  const placingContractId = ref<string | null>(null);
  const boundProject = ref(projectStore.currentProject);
  const sessionMode = ref<EventPlacementMode>('placement');
  const reviewAskId = ref<string | null>(null);
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const sessionEvents = computed(() => activeSession.value?.events ?? []);
  const isReviewMode = computed(() => sessionMode.value === 'review');

  function isVisibleQueueEvent(event: PlacementListEvent) {
    return event.status !== 'rejected' && event.status !== 'abandoned';
  }

  function isReviewQueueEvent(event: PlacementListEvent) {
    return isVisibleQueueEvent(event) && event.status === 'reviewing';
  }

  function isPlaceableQueueEvent(event: PlacementListEvent) {
    return isVisibleQueueEvent(event) && event.status !== 'reviewing';
  }

  const reviewingEvents = computed(() => sessionEvents.value.filter(isReviewQueueEvent));
  const placeableEvents = computed(() => sessionEvents.value.filter(isPlaceableQueueEvent));
  const reviewingCount = computed(() => reviewingEvents.value.length);
  const placeablePendingCount = computed(() =>
    placeableEvents.value.filter((e) => !isPlacedStatus(e.status)).length,
  );

  const activeFocus = computed<EventPlacementFocus | null>(() => {
    const session = activeSession.value;
    const contractId = placingContractId.value;
    if (!session || !contractId) return null;
    const item = session.events.find((e) => e.contractId === contractId);
    if (!item || !isPlaceableQueueEvent(item)) return null;
    return {
      askId: session.askId,
      sessionId: session.sessionId,
      contractId: item.contractId,
      eventName: item.eventName || item.contractId,
      sceneId: item.sceneId,
      targetMapId: item.targetMapId ?? null,
      placementHint: item.placementHint,
      summary: item.summary,
      trigger: item.trigger,
    };
  });

  const pendingCount = computed(() =>
    isReviewMode.value ? reviewingCount.value : placeablePendingCount.value,
  );

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistSession();
    }, 100);
  }

  async function persistSession(options: { throwOnError?: boolean } = {}) {
    if (isReviewMode.value) return;
    const session = activeSession.value;
    if (!session) return;
    const events = session.events.filter(isPlaceableQueueEvent);
    const hasPending = events.some((event) => !isPlacedStatus(event.status));
    try {
      if (!hasPending) {
        await placementQueueApi.clear(boundProject.value);
        return;
      }
      await placementQueueApi.save({ ...session, events }, boundProject.value);
    } catch (error) {
      console.warn('[event-placement] persist queue failed', error);
      if (options.throwOnError) throw error;
    }
  }

  function bindProject(project: string = projectStore.currentProject) {
    boundProject.value = project;
  }

  function openSession(session: EventPlacementSession, contractId?: string, mode: EventPlacementMode = 'placement') {
    const events = session.events.filter(isVisibleQueueEvent);
    sessionMode.value = mode;
    if (mode === 'placement') reviewAskId.value = null;
    activeSession.value = {
      ...session,
      events: events.map((e) => ({ ...e })),
    };
    placingContractId.value = null;
    selectedContractId.value = contractId
      || events.find((e) => !isPlacedStatus(e.status))?.contractId
      || events[0]?.contractId
      || null;
    schedulePersist();
  }

  function applyRefreshedSession(session: EventPlacementSession | null) {
    if (!session?.events?.length) {
      activeSession.value = null;
      selectedContractId.value = null;
      placingContractId.value = null;
      sessionMode.value = 'placement';
      reviewAskId.value = null;
      return;
    }
    const previousSelected = selectedContractId.value;
    const previousPlacing = placingContractId.value;
    sessionMode.value = 'placement';
    reviewAskId.value = null;
    activeSession.value = {
      ...session,
      events: session.events.map((event) => ({ ...event })),
    };
    selectedContractId.value = session.events.some((event) => event.contractId === previousSelected)
      ? previousSelected
      : null;
    placingContractId.value = session.events.some(
      (event) => event.contractId === previousPlacing && !isPlacedStatus(event.status),
    ) ? previousPlacing : null;
  }

  /** 从对话进入地图编排：设置 session、events 列表与 activeContractId */
  async function startPlacementSession(
    askId: string,
    events: PlacementListEvent[],
    options: StartPlacementSessionOptions,
  ) {
    bindProject(options.project || projectStore.currentProject);
    openSession(
      {
        askId,
        sessionId: options.sessionId,
        events,
      },
      options.contractId,
      'placement',
    );
  }

  function startReviewSession(
    events: PlacementListEvent[],
    options: StartReviewSessionOptions,
  ) {
    if (!events.length) return;
    bindProject(options.project || projectStore.currentProject);
    const reviewEvents = events
      .filter(isVisibleQueueEvent)
      .map((event) => ({ ...event, status: event.status || 'reviewing' }));
    if (!reviewEvents.length) return;
    const session: EventPlacementSession = {
      askId: options.askId || activeSession.value?.askId || `event-review-${Date.now()}`,
      sessionId: options.sessionId,
      events: reviewEvents,
    };
    if (activeSession.value && isReviewMode.value && activeSession.value.sessionId === options.sessionId) {
      const incoming = new Map(reviewEvents.map((event) => [event.contractId, event]));
      const merged = activeSession.value.events.map((event) => (
        incoming.has(event.contractId) ? { ...event, ...incoming.get(event.contractId)! } : event
      ));
      for (const event of reviewEvents) {
        if (!merged.some((current) => current.contractId === event.contractId)) merged.push(event);
      }
      session.events = merged;
    }
    openSession(session, selectedContractId.value || reviewEvents[0]?.contractId, 'review');
  }

  async function restoreSession(project: string = projectStore.currentProject) {
    try {
      await refreshFromRegistry(project);
    } catch (error) {
      console.warn('[event-placement] restore queue failed', error);
    }
  }

  /** 从后端队列恢复并与 event-registry / 地图事实对账。失败时保留当前 UI 状态。 */
  async function refreshFromRegistry(project: string = projectStore.currentProject) {
    if (isReviewMode.value) return activeSession.value;
    bindProject(project);
    if (activeSession.value) await persistSession({ throwOnError: true });
    const session = await placementQueueApi.get(project) as EventPlacementSession | null;
    applyRefreshedSession(session);
    return activeSession.value;
  }

  function placementEventFromRegistryRow(row: Record<string, unknown>): PlacementListEvent | null {
    const contractId = String(row.id || '').trim();
    if (!contractId) return null;
    const mapId = Number(row.mapId);
    return {
      contractId,
      eventName: String(row.eventName || contractId),
      sceneId: row.sceneId != null && String(row.sceneId).trim()
        ? String(row.sceneId).trim()
        : undefined,
      targetMapId: Number.isInteger(mapId) && mapId > 0 ? mapId : null,
      summary: row.purpose != null && String(row.purpose).trim()
        ? String(row.purpose).trim()
        : undefined,
      status: 'reviewing',
    };
  }

  /** 侧栏为空时，从注册表拉回 reviewing 契约进入待确认预览。 */
  async function syncReviewingFromRegistry(project: string = projectStore.currentProject) {
    if (isReviewMode.value && reviewingCount.value > 0) return reviewingEvents.value;
    bindProject(project);
    const payload = await eventRegistry.contracts(project) as { contracts?: Array<Record<string, unknown>> };
    const reviewing = (payload.contracts || [])
      .filter((row) => String(row.status || '') === 'reviewing')
      .map((row) => placementEventFromRegistryRow(row))
      .filter((row): row is PlacementListEvent => row != null);
    if (!reviewing.length) return [];
    startReviewSession(reviewing, {
      sessionId: activeSession.value?.sessionId || 'registry',
      project,
    });
    return reviewing;
  }

  const activeContractId = computed(() => selectedContractId.value);

  function openFocus(focus: EventPlacementFocus) {
    if (!activeSession.value || activeSession.value.askId !== focus.askId) {
      openSession({
        askId: focus.askId,
        sessionId: focus.sessionId,
        events: [{
          contractId: focus.contractId,
          eventName: focus.eventName,
          sceneId: focus.sceneId,
          targetMapId: focus.targetMapId,
          placementHint: focus.placementHint,
          summary: focus.summary,
          trigger: focus.trigger,
        }],
      }, focus.contractId);
      return;
    }
    selectedContractId.value = focus.contractId;
  }

  function selectContract(contractId: string) {
    selectedContractId.value = contractId;
  }

  function startPlacing(contractId: string) {
    const item = activeSession.value?.events.find((event) => event.contractId === contractId);
    if (!item || !isPlaceableQueueEvent(item)) return;
    selectedContractId.value = contractId;
    placingContractId.value = contractId;
  }

  function stopPlacing() {
    placingContractId.value = null;
  }

  function syncEventsFromAsk(events: PlacementListEvent[], options?: SyncPlacementAskOptions) {
    sessionMode.value = 'placement';
    reviewAskId.value = null;
    const removedContractIds = new Set(
      events.filter((event) => !isVisibleQueueEvent(event)).map((event) => event.contractId),
    );
    events = events.filter(isPlaceableQueueEvent);
    if (options?.project) bindProject(options.project);
    if (!activeSession.value) {
      if (!options || !events.length) return;
      applyRefreshedSession({
        askId: options.askId,
        sessionId: options.sessionId,
        events,
      });
      return;
    }
    const incoming = new Map(events.map((event) => [event.contractId, event]));
    const merged = activeSession.value.events
      .filter((event) => !removedContractIds.has(event.contractId))
      .map((event) => (
        incoming.has(event.contractId) ? { ...event, ...incoming.get(event.contractId)! } : event
      ));
    for (const event of events) {
      if (!merged.some((current) => current.contractId === event.contractId)) {
        merged.push({ ...event });
      }
    }
    activeSession.value = {
      ...activeSession.value,
      ...(options ? { askId: options.askId, sessionId: options.sessionId } : {}),
      events: merged,
    };
    if (!merged.some((event) => event.contractId === selectedContractId.value)) selectedContractId.value = null;
    if (!merged.some((event) => event.contractId === placingContractId.value)) placingContractId.value = null;
    schedulePersist();
  }

  function markEventPlaced(
    contractId: string,
    patch: Partial<Pick<PlacementListEvent, 'status' | 'placedEventId' | 'x' | 'y' | 'targetMapId'>>,
  ) {
    if (!activeSession.value) return;
    activeSession.value = {
      ...activeSession.value,
      events: activeSession.value.events.map((event) =>
        event.contractId === contractId ? { ...event, ...patch, status: patch.status || 'placed' } : event,
      ),
    };
    selectedContractId.value = contractId;
    if (placingContractId.value === contractId) {
      placingContractId.value = null;
    }
    schedulePersist();
  }

  /** 从当前批次移除一个事件（用户拒绝放置后调用）。 */
  function removeEvent(contractId: string) {
    if (!activeSession.value) return;
    const events = activeSession.value.events.filter((e) => e.contractId !== contractId);
    activeSession.value = { ...activeSession.value, events };
    if (selectedContractId.value === contractId) {
      selectedContractId.value = events.find((e) => !isPlacedStatus(e.status))?.contractId
        || events[0]?.contractId
        || null;
    }
    if (placingContractId.value === contractId) placingContractId.value = null;
    schedulePersist();
  }

  /** 撤回拒绝：把事件按原位置插回当前批次。 */
  function restoreEvent(event: PlacementListEvent, index: number) {
    if (!activeSession.value) return;
    if (activeSession.value.events.some((e) => e.contractId === event.contractId)) return;
    const events = [...activeSession.value.events];
    const at = Math.max(0, Math.min(index, events.length));
    events.splice(at, 0, { ...event });
    activeSession.value = { ...activeSession.value, events };
    selectedContractId.value = event.contractId;
    schedulePersist();
  }

  function clearFocus() {
    activeSession.value = null;
    selectedContractId.value = null;
    placingContractId.value = null;
    sessionMode.value = 'placement';
    reviewAskId.value = null;
    schedulePersist();
  }

  function bindReviewAsk(askId: string) {
    if (!isReviewMode.value || !activeSession.value) return;
    reviewAskId.value = askId;
    activeSession.value = { ...activeSession.value, askId };
  }

  async function refreshPlacementQueueWithoutReplacingReview(project: string = projectStore.currentProject) {
    bindProject(project);
    await placementQueueApi.get(project);
  }

  async function settleReviewEvent(
    contractId: string,
    status: 'draft' | 'rejected',
    project: string = projectStore.currentProject,
  ) {
    if (!activeSession.value) return;
    const events = status === 'draft'
      ? activeSession.value.events.map((event) => (
        event.contractId === contractId ? { ...event, status: 'draft' } : event
      ))
      : activeSession.value.events.filter((event) => event.contractId !== contractId);
    activeSession.value = { ...activeSession.value, events };
    if (placingContractId.value === contractId) placingContractId.value = null;

    const nextReview = events.find(isReviewQueueEvent);
    if (nextReview) {
      selectedContractId.value = nextReview.contractId;
      await refreshPlacementQueueWithoutReplacingReview(project);
      return;
    }

    sessionMode.value = 'placement';
    reviewAskId.value = null;
    const session = await placementQueueApi.get(project) as EventPlacementSession | null;
    applyRefreshedSession(session);
  }

  async function markReviewEventApproved(contractId: string, project?: string) {
    await settleReviewEvent(contractId, 'draft', project || boundProject.value);
  }

  async function markReviewEventRejected(contractId: string, project?: string) {
    await settleReviewEvent(contractId, 'rejected', project || boundProject.value);
  }

  function markReviewApproved() {
    if (!activeSession.value) return;
    activeSession.value = {
      ...activeSession.value,
      events: activeSession.value.events.map((event) => (
        event.status === 'reviewing' ? { ...event, status: 'draft' } : event
      )),
    };
    sessionMode.value = 'placement';
    reviewAskId.value = null;
    schedulePersist();
  }

  return {
    activeSession,
    activeFocus,
    activeContractId,
    placingContractId,
    sessionEvents,
    reviewingEvents,
    placeableEvents,
    pendingCount,
    reviewingCount,
    placeablePendingCount,
    selectedContractId,
    boundProject,
    sessionMode,
    isReviewMode,
    reviewAskId,
    openSession,
    startPlacementSession,
    startReviewSession,
    restoreSession,
    refreshFromRegistry,
    syncReviewingFromRegistry,
    openFocus,
    selectContract,
    startPlacing,
    stopPlacing,
    syncEventsFromAsk,
    markEventPlaced,
    removeEvent,
    restoreEvent,
    clearFocus,
    bindReviewAsk,
    markReviewEventApproved,
    markReviewEventRejected,
    markReviewApproved,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useEventPlacementAskStore, import.meta.hot));
}
