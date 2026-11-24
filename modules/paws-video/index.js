import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

const Native = Platform.OS === 'android' ? requireOptionalNativeModule('PawsVideo') : null;

// Re-encode a video: no sound, sped up by `speed`, short side `shortSide` px, H.264 ~2.5 Mbit/s.
// Resolves { uri, durationMs, size }.
export async function processVideo(uri, speed, shortSide = 720) {
  if (!Native) throw new Error('video_unsupported');
  return Native.process(uri, speed, shortSide);
}
export const videoSupported = !!Native;
