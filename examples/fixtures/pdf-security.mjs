import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from 'pdf-lib';

const execute = promisify(execFile);
export const openssl = process.env.OPENSSL_PATH || (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
export async function makeTestCertificate(directory) {
  const key = join(directory, 'test-key.pem'), cert = join(directory, 'test-cert.pem'), p12 = join(directory, 'test-cert.p12');
  const passwordPath = join(directory, 'certificate-password.txt');
  const password = 'FlowKit-test-certificate-only';
  await writeFile(passwordPath, password, { mode: 0o600 });
  await execute(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-sha256', '-days', '2', '-nodes', '-subj', '/CN=FlowKit Test'], { windowsHide: true });
  await execute(openssl, ['pkcs12', '-export', '-inkey', key, '-in', cert, '-out', p12, '-passout', `file:${passwordPath}`], { windowsHide: true });
  return { file: { name: 'test-cert.p12', data: await readFile(p12) }, password, passwordPath };
}

export async function makeImagePdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('Metadata image sample');
  const page = doc.addPage([300, 400]);
  const stream = doc.context.flateStream(randomBytes(900 * 900 * 3), { Type: 'XObject', Subtype: 'Image', Width: 900, Height: 900, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
  const imageName = page.node.newXObject('Sample', doc.context.register(stream));
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(280, 0, 0, 280, 10, 50), drawObject(imageName), popGraphicsState());
  return Buffer.from(await doc.save());
}

export async function verifyTestSignature(data, directory) {
  const range = data.toString('latin1').match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  if (!range) throw new Error('No signature byte range');
  const [a, b, c, d] = range.slice(1).map(Number);
  const content = Buffer.concat([data.subarray(a, a + b), data.subarray(c, c + d)]);
  const padded = Buffer.from(data.subarray(a + b + 1, c - 1).toString('ascii'), 'hex');
  const lengthBytes = padded[1] & 128 ? padded[1] & 127 : 0;
  const size = lengthBytes ? 2 + lengthBytes + padded.readUIntBE(2, lengthBytes) : 2 + padded[1];
  const signaturePath = join(directory, 'signature.der'), contentPath = join(directory, 'signed-content.bin');
  await writeFile(signaturePath, padded.subarray(0, size)); await writeFile(contentPath, content);
  await execute(openssl, ['cms', '-verify', '-binary', '-inform', 'DER', '-in', signaturePath, '-content', contentPath, '-noverify', '-out', join(directory, 'verified-content.bin')], { windowsHide: true });
  return content;
}
