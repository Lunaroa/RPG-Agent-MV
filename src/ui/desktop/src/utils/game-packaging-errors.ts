import type { MessageKey } from '../i18n/messages';

export function packagingErrorKey(message: string): MessageKey | undefined {
  if (message.startsWith('The fixed Android shell requires Android 7.0')) return 'gamePackaging.minimumAndroidVersion';
  if (message.startsWith('Encrypted Android mobile audio cannot')) return 'gamePackaging.audioPreparationEncrypted';
  if (message.startsWith('Confirm Android audio preparation')) return 'gamePackaging.audioPreparationChanged';
  if (message.startsWith('Android audio preparation requires the managed')) return 'gamePackaging.audioPreparationToolsMissing';
  if (message.startsWith('The managed Android toolchain path must')) return 'gamePackaging.error.androidPath';
  if (message.startsWith('Managed FFmpeg is required')) return 'gamePackaging.error.mediaMissing';
  if (message.startsWith('WAV compression is not configured')) return 'gamePackaging.error.wav';
  if (message.startsWith('Install the managed Android toolchain before building')) return 'gamePackaging.error.androidMissing';
  if (message.startsWith('No complete Windows')) return 'gamePackaging.error.runtimeMissing';
  if (message.includes('timed out')) return 'gamePackaging.error.timeout';
  if (message === 'The build process was canceled.') return 'gamePackaging.error.canceled';
  return undefined;
}
