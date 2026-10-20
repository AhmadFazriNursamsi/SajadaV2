export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export const TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;
export const MAX_IMAGE_BYTES = 1_000_000;

/** Tanda tangan berkas: isi harus benar-benar gambar sesuai jenis yang diklaim. */
export const looksLike = (t: keyof typeof EXT, b: Buffer) =>
  (t === 'image/jpeg' && b[0] === 0xff && b[1] === 0xd8) ||
  (t === 'image/png' && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ||
  (t === 'image/webp' && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP');
