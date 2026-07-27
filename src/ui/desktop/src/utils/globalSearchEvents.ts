/** Window event that asks the global search dialog to open (fired by rail/menu entries). */
export const GLOBAL_SEARCH_OPEN_EVENT = 'luna-rpg:global-search:open'

export function requestGlobalSearchOpen(): void {
  window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT))
}
