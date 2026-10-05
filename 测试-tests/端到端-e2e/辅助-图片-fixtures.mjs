// 辅助-图片-fixtures.mjs · E2E 图片夹具（内嵌 base64 真图，无需外部文件）
// 标准 JPEG（1×1，FFD8FF 开头 / FFD9 结尾，浏览器可解码，通过后端魔数校验）
export const JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

export const JPEG_NAME = '回忆照片.jpg';

export function jpegBuffer() {
  return Buffer.from(JPEG_BASE64, 'base64');
}

// 标准 PNG（1×1 透明，89 50 4E 47 开头）备用
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export function pngBuffer() {
  return Buffer.from(PNG_BASE64, 'base64');
}