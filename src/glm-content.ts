import type { GLMImageContentPart, GLMMessageContent, GLMTextContentPart } from './types';

const IMAGE_DATA_URL_PATTERN = /^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;
const IMAGE_DATA_URL_IN_TEXT_PATTERN = /data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}/g;

export function createGLMImageContentPart(mimeType: string, data: Uint8Array): GLMImageContentPart {
	if (!mimeType.startsWith('image/')) {
		throw new Error(`Unsupported native image MIME type: ${mimeType}`);
	}
	const base64 = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
	return {
		type: 'image_url',
		image_url: { url: `data:${mimeType};base64,${base64}` },
	};
}

export function isGLMContentPartArray(
	content: GLMMessageContent,
): content is Array<GLMTextContentPart | GLMImageContentPart> {
	return Array.isArray(content);
}

export function getGLMContentText(content: GLMMessageContent): string {
	if (typeof content === 'string') {
		return content;
	}
	return content
		.filter((part): part is GLMTextContentPart => part.type === 'text')
		.map((part) => part.text)
		.join('');
}

export function parseGLMImageDataUrl(url: string): { mimeType: string; data: string } {
	const match = IMAGE_DATA_URL_PATTERN.exec(url);
	if (!match) {
		throw new Error('Native image data URL is not a supported base64 image.');
	}
	return { mimeType: match[1], data: match[2] };
}

/** Remove native image bytes from diagnostic strings without changing API payloads. */
export function redactGLMImageDataUrls(value: string): string {
	return value.replace(IMAGE_DATA_URL_IN_TEXT_PATTERN, '[redacted native image data URL]');
}
