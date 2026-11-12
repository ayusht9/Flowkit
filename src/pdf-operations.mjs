export const pdfOperations = [
  { type: 'pdf.extract', title: 'Extract PDF pages', description: 'Split out selected pages into one new PDF', hasPages: true, defaults: { pages: 'all' } },
  { type: 'pdf.rotate', title: 'Rotate PDF pages', description: 'Rotate selected pages clockwise without rasterizing', hasPages: true, defaults: { pages: 'all', degrees: 90 } },
  { type: 'pdf.remove', title: 'Remove PDF pages', description: 'Remove selected pages and keep the remaining pages in order', hasPages: true, defaults: { pages: '1' } },
  { type: 'pdf.reverse', title: 'Reverse PDF pages', description: 'Reverse the order of all pages', defaults: {} },
  { type: 'pdf.reduce', title: 'PDF Size Reducer', description: 'Reduce PDF size toward a requested factor with automatic or manual quality', defaults: { factor: 2, autoQuality: true, quality: 80 } },
  { type: 'pdf.sign', title: 'Sign PDF', description: 'Place a signature image or sign with a PKCS#12 certificate', defaults: { mode: 'image', page: 1, x: 36, y: 36, width: 160, height: 60 } },
  { type: 'pdf.encrypt', title: 'Encrypt PDF', description: 'Protect a PDF with an opening password using AES-256', defaults: {} },
  { type: 'pdf.decrypt', title: 'Decrypt PDF', description: 'Remove PDF encryption using a supplied password', defaults: {} },
];

export function selectPdfPages(pages = 'all', pageCount = 1000) {
  if (typeof pages !== 'string' || pages.length > 1024 || !pages.length)
    throw new TypeError('Pages: use all or page numbers/ranges such as 1-3,5');
  if (pages === 'all') return Array.from({ length: pageCount }, (_, index) => index + 1);
  if (!/^[1-9]\d{0,3}(?:-[1-9]\d{0,3})?(?:,[1-9]\d{0,3}(?:-[1-9]\d{0,3})?)*$/.test(pages))
    throw new TypeError('Pages: use all or page numbers/ranges such as 1-3,5 (no spaces)');
  const selected = [];
  for (const range of pages.split(',')) {
    const [start, end = start] = range.split('-').map(Number);
    if (start > end || end > pageCount || selected.length + end - start + 1 > 1000)
      throw new RangeError(`Pages must be ascending within each range, within the PDF's ${pageCount} pages, and total at most 1000`);
    for (let page = start; page <= end; page++) selected.push(page);
  }
  return selected;
}
