/**
 * Re-export runtime presets for the bench harness so benchmark runs can pin
 * the same model/role profiles as the live runtime.
 */
export {
  DEFAULT_PRESET_ID,
  getPreset,
  isPresetId,
  listPresets,
  type ModelPreset,
} from '@artificer-ai/runtime';
