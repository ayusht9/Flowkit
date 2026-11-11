// Shared by the visual editor, MCP schemas and native option validation.
const pixels = (key, label, required = true) => ({ key, label, min: 1, max: 4096, step: 1, required });
export const imageOperations = [
  { type: 'image.resize', title: 'Resize image', description: 'Fit within dimensions, preserving aspect ratio', suffix: 'resized',
    defaults: { width: 800, height: 800 }, fields: [pixels('width', 'Maximum width (px)', false), pixels('height', 'Maximum height (px)', false)] },
  { type: 'image.crop', title: 'Crop image', description: 'Crop a rectangle from the oriented image', suffix: 'cropped',
    defaults: { width: 100, height: 100, x: 0, y: 0 }, fields: [pixels('width', 'Crop width (px)'), pixels('height', 'Crop height (px)'),
      { key: 'x', label: 'Left offset (px)', min: 0, max: 8191, step: 1, default: 0 },
      { key: 'y', label: 'Top offset (px)', min: 0, max: 8191, step: 1, default: 0 }] },
  { type: 'image.rotate', title: 'Rotate image', description: 'Rotate clockwise by 90, 180 or 270 degrees', suffix: 'rotated', defaults: { degrees: 90 },
    fields: [{ key: 'degrees', label: 'Clockwise rotation', choices: [90, 180, 270], default: 90 }] },
  { type: 'image.flip', title: 'Flip / mirror image', description: 'Mirror horizontally or flip vertically', suffix: 'flipped', defaults: { direction: 'horizontal' },
    fields: [{ key: 'direction', label: 'Flip direction', choices: ['horizontal', 'vertical', 'both'], default: 'horizontal' }] },
  { type: 'image.grayscale', title: 'Grayscale image', description: 'Convert colors to shades of gray', suffix: 'grayscale', defaults: {}, fields: [] },
  { type: 'image.blur', title: 'Blur image', description: 'Apply a Gaussian blur', suffix: 'blurred', defaults: { sigma: 1 },
    fields: [{ key: 'sigma', label: 'Blur strength (sigma)', min: 0.1, max: 10, step: 0.1, default: 1 }] },
  { type: 'image.sharpen', title: 'Sharpen image', description: 'Sharpen image details', suffix: 'sharpened', defaults: { sigma: 1 },
    fields: [{ key: 'sigma', label: 'Sharpen strength (sigma)', min: 0.1, max: 5, step: 0.1, default: 1 }] },
  { type: 'image.convert', title: 'Convert image', description: 'Convert to PNG or JPEG; JPEG uses a white background for transparency', suffix: 'converted',
    defaults: { format: 'png', quality: 85 }, fields: [
      { key: 'format', label: 'Image output format', choices: ['png', 'jpeg'], default: 'png' },
      { key: 'quality', label: 'JPEG quality', min: 1, max: 100, step: 1, default: 85 },
    ] },
];
