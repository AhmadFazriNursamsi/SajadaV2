import { createHmac, timingSafeEqual } from 'node:crypto';
import { Body, Controller, ForbiddenException, Get, Header, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res, UnauthorizedException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import type { z } from 'zod';
import { companyProfileSchema, terbilangRupiah } from '@sajadah/shared';
import { Database } from '../db/db';
import { depots, products, stockRequestLines, stockRequests, tenants } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { ADMIN, CurrentActor, Public, Roles, STAFF } from '../auth/auth.decorators';
import { jwtSecret } from '../auth/auth.module';
import type { Actor } from '../auth/auth.types';

const GREEN = '#005641', GOLD = '#c8992b', INK = '#00271d', MUTED = '#4a6b62', LINE = '#c9d9d4';
const LINK_TTL_MS = 10 * 60 * 1000;
const rp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;
const dateId = (d: Date) => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
const EMPTY = '(belum diisi)';

interface InvoiceData {
  invoiceNo: string; requestNo: string; createdAt: Date; status: 'pending' | 'sent' | 'rejected' | 'cancelled'; note: string | null; createdByName: string;
  company: { name: string; legalName: string | null; address: string | null; npwp: string | null; phone: string | null; signatory: string | null; signatoryTitle: string | null };
  depot: { name: string; address: string | null };
  lines: { sku: string; name: string; qty: number; price: number }[];
}

const STATUS_NOTE = {
  pending: 'Jumlah sesuai permintaan; akan disesuaikan dengan barang yang benar-benar dikirim pusat.',
  sent: 'Jumlah sesuai barang yang dikirim pusat.',
  rejected: 'Permintaan ditolak oleh pusat. Dokumen ini tidak dapat ditagihkan.',
  cancelled: 'Permintaan dibatalkan. Dokumen ini tidak dapat ditagihkan.',
} as const;

/** Susun dokumen PDF A4: kop badan usaha, pihak, rincian barang, total + terbilang, catatan, dan kolom tanda tangan. */
function render(d: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${d.invoiceNo}`, Author: d.company.legalName ?? d.company.name, Subject: `Permintaan barang ${d.requestNo}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const L = 50, W = doc.page.width - 100;
    const void_ = d.status === 'rejected' || d.status === 'cancelled';

    // Kop
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(16).text(d.company.legalName ?? d.company.name, L, 50, { width: W * 0.6 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(d.company.address ?? `Alamat ${EMPTY}`, L, doc.y + 2, { width: W * 0.6 });
    doc.text(`NPWP: ${d.company.npwp || EMPTY}   Telp: ${d.company.phone || EMPTY}`, L, doc.y + 1, { width: W * 0.6 });
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(26).text('INVOICE', L, 50, { width: W, align: 'right' });
    doc.fillColor(INK).font('Helvetica').fontSize(10).text(d.invoiceNo, L, 80, { width: W, align: 'right' });
    const top = Math.max(doc.y, 100) + 10;
    doc.moveTo(L, top).lineTo(L + W, top).lineWidth(2).strokeColor(GOLD).stroke();

    // Info dokumen dan pihak
    let y = top + 14;
    const kv = (k: string, v: string, x: number, yy: number) => { doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(k, x, yy, { width: 90 }); doc.fillColor(INK).font('Helvetica-Bold').text(v, x + 92, yy, { width: W / 2 - 100 }); };
    kv('Tanggal', dateId(d.createdAt), L, y); kv('No. Invoice', d.invoiceNo, L, y + 14); kv('No. Permintaan', d.requestNo, L, y + 28);
    kv('Status', ({ pending: 'Menunggu pusat', sent: 'Dikirim', rejected: 'Ditolak', cancelled: 'Dibatalkan' } as const)[d.status], L, y + 42);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('DITAGIHKAN KEPADA', L + W / 2, y);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(d.depot.name, L + W / 2, y + 13, { width: W / 2 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(d.depot.address ?? `Alamat toko ${EMPTY}`, L + W / 2, doc.y + 1, { width: W / 2 });
    doc.text(`Diminta oleh: ${d.createdByName}`, L + W / 2, doc.y + 1, { width: W / 2 });
    y = Math.max(doc.y, y + 62) + 14;

    // Tabel
    const cols = [{ h: 'No', w: 28, a: 'left' }, { h: 'SKU', w: 62, a: 'left' }, { h: 'Nama barang', w: W - 28 - 62 - 50 - 90 - 100, a: 'left' }, { h: 'Jml', w: 50, a: 'right' }, { h: 'Harga satuan', w: 90, a: 'right' }, { h: 'Jumlah', w: 100, a: 'right' }] as const;
    const row = (cells: string[], yy: number, head = false) => {
      let x = L;
      cols.forEach((c, i) => { doc.fillColor(head ? '#ffffff' : INK).font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(cells[i]!, x + 5, yy + 6, { width: c.w - 10, align: c.a, lineBreak: !head }); x += c.w; });
    };
    doc.rect(L, y, W, 22).fill(GREEN); row(cols.map((c) => c.h), y, true); y += 22;
    let total = 0;
    d.lines.forEach((l, i) => {
      const sub = l.qty * l.price; total += sub;
      const h = Math.max(22, doc.heightOfString(l.name, { width: cols[2].w - 10, fontSize: 9 } as never) + 12);
      if (y + h > doc.page.height - 260) { doc.addPage(); y = 50; }
      if (i % 2) doc.rect(L, y, W, h).fill('#f2f7f5');
      row([String(i + 1), l.sku, l.name, String(l.qty), rp(l.price), rp(sub)], y);
      y += h;
    });
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.7).strokeColor(LINE).stroke();

    // Total
    y += 10;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Subtotal', L + W - 260, y, { width: 150, align: 'right' }); doc.fillColor(INK).text(rp(total), L + W - 100, y, { width: 100, align: 'right' });
    doc.fillColor(MUTED).text('PPN', L + W - 260, y + 14, { width: 150, align: 'right' }); doc.fillColor(INK).text('tidak dipungut', L + W - 100, y + 14, { width: 100, align: 'right' });
    doc.rect(L + W - 260, y + 30, 260, 26).fill(GREEN);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('TOTAL', L + W - 250, y + 37, { width: 90 }).text(rp(total), L + W - 150, y + 37, { width: 140, align: 'right' });
    y += 70;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Terbilang:', L, y);
    doc.fillColor(INK).font('Helvetica-Oblique').fontSize(10).text(`${terbilangRupiah(total)}`.replace(/^./, (c) => c.toUpperCase()), L + 50, y - 1, { width: W - 50 });
    y = doc.y + 12;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Catatan: ${STATUS_NOTE[d.status]}${d.note ? ` Keterangan toko: ${d.note}.` : ''}`, L, y, { width: W });
    doc.text('Harga satuan memakai harga jual produk saat permintaan dibuat. Pembayaran/penyelesaian mengikuti ketentuan koperasi.', L, doc.y + 3, { width: W });

    // Tanda tangan
    const sy = Math.max(doc.y + 24, doc.page.height - 200);
    if (sy > doc.page.height - 150) doc.addPage();
    const py = doc.y > doc.page.height - 200 ? 60 : sy;
    const sign = (title: string, name: string, role: string, x: number) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(title, x, py, { width: 200, align: 'center' });
      doc.moveTo(x + 30, py + 70).lineTo(x + 170, py + 70).lineWidth(0.7).strokeColor(INK).stroke();
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(name, x, py + 74, { width: 200, align: 'center' });
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(role, x, py + 88, { width: 200, align: 'center' });
    };
    sign('Pemohon', d.createdByName, `Petugas ${d.depot.name}`, L);
    sign('Disetujui / Penerbit', d.company.signatory || EMPTY, d.company.signatoryTitle || 'Pengurus', L + W - 200);

    // Penanda batal dan catatan keaslian
    if (void_) doc.save().rotate(-30, { origin: [300, 400] }).fillColor('#a3321f').opacity(0.18).font('Helvetica-Bold').fontSize(80).text(d.status === 'rejected' ? 'DITOLAK' : 'DIBATALKAN', 90, 360, { width: 420, align: 'center' }).restore();
    doc.page.margins.bottom = 0; // catatan kaki di tepi bawah tidak boleh memicu halaman baru
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(`Dokumen ini diterbitkan oleh sistem Sajadah Koperasi Digital pada ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB dan berlaku sebagai nota/invoice internal koperasi setelah ditandatangani pihak berwenang. Dokumen ini bukan faktur pajak.`, L, doc.page.height - 66, { width: W, align: 'center' });
    doc.end();
  });
}

const sign = (id: string, exp: number) => createHmac('sha256', jwtSecret()).update(`inv:${id}:${exp}`).digest('base64url');

/** Invoice PDF untuk permintaan stok ke pusat + profil badan usaha untuk kop. */
@Injectable()
export class InvoicesService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) {}

  async profile(tid: string) {
    const [t] = await this.db.select().from(tenants).where(eq(tenants.id, tid));
    return { name: t!.name, legalName: t!.legalName, address: t!.address, npwp: t!.npwp, phone: t!.phone, signatory: t!.signatory, signatoryTitle: t!.signatoryTitle };
  }

  async updateProfile(a: Actor, input: z.infer<typeof companyProfileSchema>) {
    const v = (x: string | undefined) => (x === undefined ? undefined : x || null);
    await this.db.transaction(async (tx) => {
      await tx.update(tenants).set({ legalName: v(input.legalName), address: v(input.address), npwp: v(input.npwp), phone: v(input.phone), signatory: v(input.signatory), signatoryTitle: v(input.signatoryTitle) }).where(eq(tenants.id, a.tid));
      await this.core.audit(tx, a, 'Profil badan usaha (kop invoice) diperbarui');
    });
    return this.profile(a.tid);
  }

  private async load(tid: string, id: string): Promise<{ data: InvoiceData; depotId: string }> {
    const [r] = await this.db.select().from(stockRequests).where(and(eq(stockRequests.tenantId, tid), eq(stockRequests.id, id)));
    if (!r) throw new NotFoundException('Permintaan tidak ditemukan.');
    let invoiceNo = r.invoiceNo;
    if (!invoiceNo) { // permintaan lama: terbitkan nomor saat pertama dibuka
      invoiceNo = await this.core.docNo(this.db, tid, 'INV');
      await this.db.update(stockRequests).set({ invoiceNo }).where(eq(stockRequests.id, id));
    }
    const [[d], ls, company] = await Promise.all([
      this.db.select().from(depots).where(eq(depots.id, r.depotId)),
      this.db.select({ l: stockRequestLines, name: products.name, sku: products.sku, price: products.sellPrice }).from(stockRequestLines).innerJoin(products, eq(products.id, stockRequestLines.productId)).where(eq(stockRequestLines.requestId, id)),
      this.profile(tid),
    ]);
    const sent = r.status === 'sent';
    const lines = ls.map((x) => ({ sku: x.sku, name: x.name, qty: sent ? x.l.qtySent : x.l.qty, price: x.l.unitPrice || x.price })).filter((l) => l.qty > 0 || !sent);
    return { depotId: r.depotId, data: { invoiceNo, requestNo: r.no, createdAt: r.createdAt, status: r.status, note: r.note, createdByName: r.createdByName, company, depot: { name: d!.name, address: d!.address }, lines } };
  }

  async pdf(a: Actor, id: string) {
    const { data, depotId } = await this.load(a.tid, id);
    if (a.role === 'staff' && a.did !== depotId) throw new ForbiddenException('Permintaan ini bukan milik toko Anda.');
    return { bytes: await render(data), name: `${data.invoiceNo}.pdf` };
  }

  /** Tautan sementara (10 menit) agar aplikasi HP bisa membuka PDF di peramban tanpa header login. */
  async link(a: Actor, id: string) {
    const { depotId } = await this.load(a.tid, id);
    if (a.role === 'staff' && a.did !== depotId) throw new ForbiddenException('Permintaan ini bukan milik toko Anda.');
    const exp = Date.now() + LINK_TTL_MS;
    return { url: `/api/invoices/stock-requests/${id}.pdf?tid=${a.tid}&exp=${exp}&sig=${sign(`${a.tid}:${id}`, exp)}` };
  }

  async pdfByLink(id: string, q: { tid?: string; exp?: string; sig?: string }) {
    const exp = Number(q.exp);
    if (!q.tid || !q.sig || !Number.isFinite(exp) || exp < Date.now()) throw new UnauthorizedException('Tautan invoice sudah kedaluwarsa. Buka lagi dari aplikasi.');
    const want = Buffer.from(sign(`${q.tid}:${id}`, exp)), got = Buffer.from(q.sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) throw new UnauthorizedException('Tautan invoice tidak valid.');
    const { data } = await this.load(q.tid, id);
    return { bytes: await render(data), name: `${data.invoiceNo}.pdf` };
  }
}

type Res_ = { header: (k: string, v: string) => unknown };
const send = (res: Res_, f: { bytes: Buffer; name: string }) => { res.header('Content-Type', 'application/pdf'); res.header('Content-Disposition', `inline; filename="${f.name}"`); res.header('Cache-Control', 'private, no-store'); return f.bytes; };

@Controller()
class InvoicesController {
  constructor(private readonly svc: InvoicesService) {}
  @Get('company-profile') @Roles(...STAFF) profile(@CurrentActor() a: Actor) { return this.svc.profile(a.tid); }
  @Put('company-profile') @Roles(...ADMIN) update(@CurrentActor() a: Actor, @Body(new ZodPipe(companyProfileSchema)) b: z.infer<typeof companyProfileSchema>) { return this.svc.updateProfile(a, b); }

  @Get('central/requests/:id/invoice') @Roles(...STAFF)
  async invoice(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Res_) { return send(res, await this.svc.pdf(a, id)); }
  @Post('central/requests/:id/invoice-link') @Roles(...STAFF)
  link(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.link(a, id); }

  /** Dibuka dari peramban HP lewat tautan bertanda tangan (kedaluwarsa 10 menit). */
  @Public() @Get('invoices/stock-requests/:file')
  async byLink(@Param('file') file: string, @Query() q: { tid?: string; exp?: string; sig?: string }, @Res({ passthrough: true }) res: Res_) {
    const id = file.replace(/\.pdf$/, '');
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new BusinessError('Alamat invoice tidak valid.');
    return send(res, await this.svc.pdfByLink(id, q));
  }
}

@Module({ controllers: [InvoicesController], providers: [InvoicesService] })
export class InvoicesModule {}
