// Turns a photo of a textbook page into something small enough to send to the assistant.
//
// A phone camera shot is several megabytes; the model only needs to read the page, so the
// image is scaled down and re-encoded as JPEG in the browser before it leaves the device.
// That keeps the request quick and well under the server's body limit.

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.82;

export type PreparedImage = {
  // Base64 without the data-URL prefix, exactly as the Gemini API expects it.
  base64: string;
  mimeType: string;
  name: string;
  // A small data URL kept in memory so the person can see what they attached.
  preview: string;
};

export type PrepareResult = { image: PreparedImage } | { error: string };

function stripPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function scaledSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE) return { width, height };
  const ratio = MAX_EDGE / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

async function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<string> {
  // toDataURL is synchronous and universally supported; the quality argument is what keeps
  // the result small enough to send.
  return canvas.toDataURL(type, quality);
}

export async function prepareImageFile(file: File): Promise<PrepareResult> {
  if (!file.type.startsWith('image/')) {
    return { error: 'That file is not a photo. Please choose a JPEG, PNG or WebP image.' };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { error: 'That photo could not be read. Try taking it again, or choose a different image.' };
  }

  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return { error: 'This browser could not prepare the photo.' };
    context.drawImage(bitmap, 0, 0, width, height);

    let dataUrl = await encode(canvas, 'image/jpeg', JPEG_QUALITY);
    // A dense page can still come out large; one more pass at a lower quality is far
    // cheaper than failing the request.
    if (dataUrl.length > 1_600_000) {
      dataUrl = await encode(canvas, 'image/jpeg', 0.6);
    }

    const base64 = stripPrefix(dataUrl);
    if (!base64) return { error: 'That photo could not be prepared. Please try another image.' };

    return {
      image: {
        base64,
        mimeType: 'image/jpeg',
        name: file.name || 'textbook-page.jpg',
        preview: dataUrl,
      },
    };
  } finally {
    bitmap.close();
  }
}
