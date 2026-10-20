/** Kecilkan foto di browser (sisi terpanjang 800 px, JPEG) lalu kembalikan isinya sebagai base64 tanpa awalan data URL. */
export async function resizeToJpeg(file: File, max = 800): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Peramban tidak mendukung pengolahan gambar');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); // latar putih untuk PNG transparan
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
}

export const imageSrc = (name: string | null) => (name ? `/api/products/image/${name}` : null);
