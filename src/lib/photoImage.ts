// One place that turns a picture into something small enough to keep on a record. A frame
// from the webcam and a file chosen from disk both arrive as pixels, so both take the same
// route: centre-crop to a square, scale down, encode as JPEG.

const PHOTO_EDGE = 320;
const PHOTO_QUALITY = 0.85;

function encode(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxSize: number,
  mirror: boolean,
): string {
  // A square crop keeps a face centred in a round avatar instead of squashing a portrait
  // into it.
  const side = Math.min(width, height);
  const sx = Math.round((width - side) / 2);
  const sy = Math.round((height - side) / 2);
  const size = Math.max(1, Math.round(Math.min(maxSize, side)));

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');

  // The live preview is shown mirrored, the way a mirror behaves, so the saved frame is
  // flipped to match what the person saw when they pressed the button.
  if (mirror) {
    context.translate(size, 0);
    context.scale(-1, 1);
  }
  context.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
}

export async function photoDataUrlFromFile(file: File, maxSize = PHOTO_EDGE): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    return encode(bitmap, bitmap.width, bitmap.height, maxSize, false);
  } finally {
    bitmap.close();
  }
}

export function photoDataUrlFromVideo(video: HTMLVideoElement, maxSize = PHOTO_EDGE): string {
  if (!video.videoWidth || !video.videoHeight) throw new Error('The camera is not ready yet');
  return encode(video, video.videoWidth, video.videoHeight, maxSize, true);
}
