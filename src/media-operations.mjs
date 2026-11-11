// Fixed media capabilities shared by native validation, MCP schemas and editor controls.
const audioFormat = { key: 'format', label: 'Audio output format', choices: ['mp3', 'wav'], default: 'mp3' };
const trimFields = [
  { key: 'startSeconds', label: 'Start (seconds)', min: 0, max: 300, step: 0.01, required: true },
  { key: 'durationSeconds', label: 'Duration (seconds)', min: 0, exclusiveMin: true, max: 300, step: 0.01, required: true },
];
export const mediaOperations = [
  { type: 'audio.convert', name: 'audio_convert', title: 'Convert audio', description: 'Convert audio to MP3 or WAV', inputType: 'audio', outputType: 'audio', defaults: { format: 'mp3' }, fields: [audioFormat] },
  { type: 'audio.trim', name: 'audio_trim', title: 'Trim audio', description: 'Choose a start time and duration', inputType: 'audio', outputType: 'audio', defaults: { startSeconds: 0, durationSeconds: 10, format: 'mp3' }, fields: [...trimFields, audioFormat] },
  { type: 'video.trim', name: 'video_trim', title: 'Trim video', description: 'Trim and encode a browser-ready MP4', inputType: 'video', outputType: 'video', defaults: { startSeconds: 0, durationSeconds: 10 }, fields: trimFields },
  { type: 'video.extractAudio', name: 'video_extract_audio', title: 'Extract audio', description: 'Save a video audio track as MP3 or WAV', inputType: 'video', outputType: 'audio', defaults: { format: 'mp3' }, fields: [audioFormat] },
  { type: 'audio.volume', name: 'audio_volume', title: 'Adjust audio volume', description: 'Change gain in decibels; positive gain can clip loud recordings', inputType: 'audio', outputType: 'audio', defaults: { gainDb: 0, format: 'mp3' }, fields: [
    { key: 'gainDb', label: 'Volume gain (dB)', min: -60, max: 12, step: 0.1, default: 0 }, audioFormat] },
  { type: 'audio.fade', name: 'audio_fade', title: 'Fade audio', description: 'Fade in at the beginning and out at the end', inputType: 'audio', outputType: 'audio', defaults: { fadeInSeconds: 0.25, fadeOutSeconds: 0.25, format: 'mp3' }, fields: [
    { key: 'fadeInSeconds', label: 'Fade in (seconds)', min: 0, max: 30, step: 0.01, default: 0.25 },
    { key: 'fadeOutSeconds', label: 'Fade out (seconds)', min: 0, max: 30, step: 0.01, default: 0.25 }, audioFormat] },
  { type: 'audio.normalize', name: 'audio_normalize', title: 'Normalize audio loudness', description: 'Apply single-pass loudness normalization with a -1.5 dBTP target peak', inputType: 'audio', outputType: 'audio', defaults: { targetLufs: -16, format: 'mp3' }, fields: [
    { key: 'targetLufs', label: 'Target loudness (LUFS)', min: -24, max: -9, step: 0.1, default: -16 }, audioFormat] },
  { type: 'video.convert', name: 'video_convert', title: 'Convert video to MP4', description: 'Encode H.264 video and optional AAC audio into MP4', inputType: 'video', outputType: 'video', defaults: { quality: 'balanced' }, fields: [
    { key: 'quality', label: 'Video quality', choices: ['compact', 'balanced', 'high'], default: 'balanced' }] },
  { type: 'video.resize', name: 'video_resize', title: 'Resize video', description: 'Fit within bounds without upscaling, preserving aspect ratio; dimensions round down to even pixels', inputType: 'video', outputType: 'video', defaults: { width: 1280, height: 720 }, fields: [
    { key: 'width', label: 'Maximum width (px)', min: 2, max: 1920, step: 1 },
    { key: 'height', label: 'Maximum height (px)', min: 2, max: 1920, step: 1 }] },
  { type: 'video.rotate', name: 'video_rotate', title: 'Rotate video', description: 'Rotate clockwise by 90, 180 or 270 degrees', inputType: 'video', outputType: 'video', defaults: { degrees: 90 }, fields: [
    { key: 'degrees', label: 'Clockwise rotation', choices: [90, 180, 270], default: 90 }] },
  { type: 'video.flip', name: 'video_flip', title: 'Flip / mirror video', description: 'Mirror horizontally or flip vertically', inputType: 'video', outputType: 'video', defaults: { direction: 'horizontal' }, fields: [
    { key: 'direction', label: 'Flip direction', choices: ['horizontal', 'vertical', 'both'], default: 'horizontal' }] },
  { type: 'video.mute', name: 'video_mute', title: 'Mute video', description: 'Remove the audio track and encode an MP4', inputType: 'video', outputType: 'video', defaults: {}, fields: [] },
];
