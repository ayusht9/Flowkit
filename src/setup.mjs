export const nativeToolRecommendations = {
  ghostscript: { name: 'Ghostscript', testedVersion: '10.08.0', purpose: 'PDF Size Reducer with image recompression', url: 'https://ghostscript.com/releases/gsdnld.html', environment: 'GHOSTSCRIPT_PATH' },
  qpdf: { name: 'qpdf', testedVersion: '12.2.0', purpose: 'PDF page operations, optimization, and inspection', url: 'https://github.com/qpdf/qpdf/releases', environment: 'QPDF_PATH' },
  pandoc: { name: 'Pandoc', testedVersion: '3.13', purpose: 'document conversions', url: 'https://pandoc.org/installing.html', environment: 'PANDOC_PATH' },
  imagemagick: { name: 'ImageMagick', testedVersion: '7.1.1-47', purpose: 'image processing', url: 'https://imagemagick.org/download/', environment: 'IMAGEMAGICK_PATH' },
  ffmpeg: { name: 'FFmpeg', testedVersion: '9.0.2', purpose: 'audio and video processing', url: 'https://ffmpeg.org/download.html', environment: 'FFMPEG_PATH' },
  ffprobe: { name: 'FFprobe', testedVersion: '9.0.2', purpose: 'media inspection; included with FFmpeg', url: 'https://ffmpeg.org/download.html', environment: 'FFPROBE_PATH' },
};

export function setupGuidance() {
  return [
    'FlowKit MCP: native tool setup',
    'Node.js 22.12+ is required. Install the processors for the operations you need:',
    ...Object.values(nativeToolRecommendations).map(tool =>
      `  ${tool.name}: tested with ${tool.testedVersion} (${tool.purpose})\n    ${tool.url}\n    Custom executable: ${tool.environment}`),
    'These are tested versions, not enforced minimums or guarantees for newer releases.',
    'Add executables to PATH or set the custom executable variables in your MCP host environment.',
    'PDF export additionally needs pdfroff (GNU groff) and Ghostscript.',
    'No native tools are downloaded or installed by this package.',
    'Check your setup: flowkit-mcp --doctor --workspace <directory>',
    'Show this guide again: flowkit-mcp --setup',
  ].join('\n');
}
