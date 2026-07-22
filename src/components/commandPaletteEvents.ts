export const OPEN_COMMAND_PALETTE_EVENT = 'hhh:open-command-palette';

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}
