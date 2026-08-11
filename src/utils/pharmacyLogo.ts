const EMAIL_LOGO_WIDTH = 640;
const EMAIL_LOGO_HEIGHT = 192;
const EMAIL_LOGO_PADDING = 32;
const MAX_SOURCE_BYTES = 8_000_000;
const ALPHA_SCAN_MAX_DIMENSION = 2048;
const VISIBLE_ALPHA_THRESHOLD = 8;
const BACKGROUND_CHANNEL_TOLERANCE = 18;
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function outputName(filename: string) {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'pharmacy';
  return `${stem}-email-logo.png`;
}

function visibleBounds(bitmap: ImageBitmap) {
  const scanScale = Math.min(1, ALPHA_SCAN_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const scanWidth = Math.max(1, Math.round(bitmap.width * scanScale));
  const scanHeight = Math.max(1, Math.round(bitmap.height * scanScale));
  const scanCanvas = document.createElement('canvas');
  scanCanvas.width = scanWidth;
  scanCanvas.height = scanHeight;
  const scanContext = scanCanvas.getContext('2d', { willReadFrequently: true });
  if (!scanContext) return { x: 0, y: 0, width: bitmap.width, height: bitmap.height };

  scanContext.drawImage(bitmap, 0, 0, scanWidth, scanHeight);
  const pixels = scanContext.getImageData(0, 0, scanWidth, scanHeight).data;
  const cornerIndexes = [
    0,
    (scanWidth - 1) * 4,
    ((scanHeight - 1) * scanWidth) * 4,
    ((scanHeight * scanWidth) - 1) * 4,
  ];
  const background = [0, 1, 2, 3].map(channel => (
    cornerIndexes.reduce((total, index) => total + pixels[index + channel], 0) / cornerIndexes.length
  ));
  const hasConsistentBackground = cornerIndexes.every(index => (
    [0, 1, 2, 3].every(channel => Math.abs(pixels[index + channel] - background[channel]) <= BACKGROUND_CHANNEL_TOLERANCE)
  ));
  let left = scanWidth;
  let top = scanHeight;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < scanHeight; y += 1) {
    for (let x = 0; x < scanWidth; x += 1) {
      const index = (y * scanWidth + x) * 4;
      const alpha = pixels[index + 3];
      if (alpha <= VISIBLE_ALPHA_THRESHOLD) continue;
      if (hasConsistentBackground && background[3] > VISIBLE_ALPHA_THRESHOLD) {
        const differsFromBackground = [0, 1, 2, 3].some(channel => (
          Math.abs(pixels[index + channel] - background[channel]) > BACKGROUND_CHANNEL_TOLERANCE
        ));
        if (!differsFromBackground) continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) throw new Error('The selected image does not contain a visible logo.');

  const inverseScale = 1 / scanScale;
  const x = Math.max(0, Math.floor(left * inverseScale));
  const y = Math.max(0, Math.floor(top * inverseScale));
  const rightEdge = Math.min(bitmap.width, Math.ceil((right + 1) * inverseScale));
  const bottomEdge = Math.min(bitmap.height, Math.ceil((bottom + 1) * inverseScale));
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

export async function normalisePharmacyLogo(file: File) {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error('Choose a PNG, JPEG or WebP logo.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('The source logo must be smaller than 8 MB.');

  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('The selected image has no usable dimensions.');
    const canvas = document.createElement('canvas');
    canvas.width = EMAIL_LOGO_WIDTH;
    canvas.height = EMAIL_LOGO_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the logo.');

    context.clearRect(0, 0, canvas.width, canvas.height);
    const bounds = visibleBounds(bitmap);
    const availableWidth = EMAIL_LOGO_WIDTH - EMAIL_LOGO_PADDING * 2;
    const availableHeight = EMAIL_LOGO_HEIGHT - EMAIL_LOGO_PADDING * 2;
    const scale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    const x = Math.round((EMAIL_LOGO_WIDTH - width) / 2);
    const y = Math.round((EMAIL_LOGO_HEIGHT - height) / 2);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, bounds.x, bounds.y, bounds.width, bounds.height, x, y, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('The logo could not be converted to PNG.')), 'image/png');
    });
    return new File([blob], outputName(file.name), { type: 'image/png', lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

export const EMAIL_LOGO_SPEC = {
  assetWidth: EMAIL_LOGO_WIDTH,
  assetHeight: EMAIL_LOGO_HEIGHT,
  displayWidth: EMAIL_LOGO_WIDTH / 2,
  displayHeight: EMAIL_LOGO_HEIGHT / 2,
} as const;
