export const pdfOperations = [
  { type: 'pdf.extract', title: 'Extract PDF pages', description: 'Split out selected pages into one new PDF', defaults: { pages: 'all' } },
  { type: 'pdf.rotate', title: 'Rotate PDF pages', description: 'Rotate selected pages clockwise without rasterizing', defaults: { pages: 'all', degrees: 90 } },
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
