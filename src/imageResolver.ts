import { readFile } from 'node:fs/promises';

const MAX_IMAGE_BYTES = 2_000_000;

export interface ImageInput {
  data?: string;
  encoding?: string;
  url?: string;
  path?: string;
  alt?: string;
}

export interface ResolvedImage {
  data: Buffer;
  encoding: string;
  alt?: string;
}

export async function resolveImages(images: ImageInput[] | undefined): Promise<ResolvedImage[] | undefined> {
  if (!images?.length) return undefined;

  const resolved: ResolvedImage[] = [];
  for (const image of images) {
    let data: Buffer;
    let encoding = image.encoding;

    if (image.data) {
      data = Buffer.from(image.data, 'base64');
    } else if (image.path) {
      data = await readFile(image.path);
    } else if (image.url) {
      const response = await fetch(image.url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Image download failed: ${response.status} ${response.statusText}`);
      const contentType = response.headers.get('content-type')?.split(';', 1)[0];
      if (!contentType?.startsWith('image/')) {
        throw new Error(`URL did not return an image: ${contentType || 'unknown content type'}`);
      }
      encoding ||= contentType;
      data = Buffer.from(await response.arrayBuffer());
    } else {
      throw new Error('Image must provide data, url, or path');
    }

    if (!encoding?.startsWith('image/')) {
      throw new Error(`Image MIME type is required and must start with image/: ${encoding || 'missing'}`);
    }
    if (data.length > MAX_IMAGE_BYTES) {
      throw new Error(`Image exceeds Bluesky's ${MAX_IMAGE_BYTES}-byte limit: ${data.length} bytes`);
    }

    resolved.push({ data, encoding, alt: image.alt });
  }

  return resolved;
}
