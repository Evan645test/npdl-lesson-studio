// FNV-1a，只用來辨識同意範圍是否改變，不作安全用途。
export function textHash(text: string): string { let hash = 0x811c9dc5; for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); } return (hash >>> 0).toString(16); }
