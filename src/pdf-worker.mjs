import { parentPort, workerData } from 'node:worker_threads';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, PDFSignature, PDFName } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { P12Signer } from '@signpdf/signer-p12';
import { SignPdf } from '@signpdf/signpdf';

try {
  const { action, inputPath, outputPath, attachmentPath, options = {}, passphrase = '' } = workerData;
  const doc = await PDFDocument.load(await readFile(inputPath), { updateMetadata: false });
  if (doc.isEncrypted) throw new Error('Encrypted PDF');
  if (doc.getPageCount() < 1 || doc.getPageCount() > 1000) throw new Error('PDF page limit');
  if (action === 'metadata') {
    const clean = value => typeof value === 'string' ? value.slice(0, 500) : undefined;
    parentPort.postMessage({ ok: true, result: { pageCount: doc.getPageCount(), title: clean(doc.getTitle()), author: clean(doc.getAuthor()),
      subject: clean(doc.getSubject()), creator: clean(doc.getCreator()), producer: clean(doc.getProducer()),
      pages: doc.getPages().slice(0, 25).map((page, index) => ({ page: index + 1, widthPoints: page.getWidth(), heightPoints: page.getHeight(), rotation: page.getRotation().angle })),
      pageDetailsTruncated: doc.getPageCount() > 25 } });
  } else {
    if (doc.getForm().getFields().some(field => field instanceof PDFSignature && field.acroField.dict.get(PDFName.of('V')))) {
      parentPort.postMessage({ ok: false, code: 'ALREADY_SIGNED' });
    } else {
      const page = doc.getPages()[(options.page ?? 1) - 1];
      if (!page) throw new Error('Invalid page');
      if ((options.mode ?? 'image') === 'image') {
        const bytes = await readFile(attachmentPath);
        const image = bytes[0] === 137 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        if (image.width * image.height > 16_000_000) throw new Error('Image pixel limit');
        const box = page.getCropBox();
        const { x = 36, y = 36, width = 160, height = 60 } = options;
        if (x + width > box.width || y + height > box.height) throw new Error('Signature outside page');
        const scale = Math.min(width / image.width, height / image.height);
        page.drawImage(image, { x: box.x + x, y: box.y + y, width: image.width * scale, height: image.height * scale });
        await writeFile(outputPath, await doc.save(), { mode: 0o600 });
      } else {
        pdflibAddPlaceholder({ pdfDoc: doc, pdfPage: page, reason: options.reason || 'Signed with FlowKit', name: options.name || '',
          contactInfo: '', location: '', signatureLength: 32768, appName: 'FlowKit', subFilter: 'adbe.pkcs7.detached' });
        const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
        const signed = await new SignPdf().sign(bytes, new P12Signer(await readFile(attachmentPath), { passphrase }));
        await writeFile(outputPath, signed, { mode: 0o600 });
      }
      parentPort.postMessage({ ok: true, result: { pageCount: doc.getPageCount() } });
    }
  }
} catch {
  // Native/library exceptions can contain sensitive certificate details. Return fixed codes only.
  parentPort.postMessage({ ok: false, code: 'PDF_WORKER_FAILED' });
}
