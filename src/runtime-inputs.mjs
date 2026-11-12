import { assertRecord } from './operations.mjs';
import { validateImage } from './image.mjs';

export function validatePassword(value, label = 'Password', { optional = false } = {}) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > 1024 || /[\r\n\0]/.test(value))
    throw new TypeError(`${label} must be 1-1024 UTF-8 bytes without line breaks`);
  return value;
}

export function validateAttachment(file, kind) {
  assertRecord(file, 'Attachment');
  if (!(file.data instanceof Uint8Array) || !file.data.length || file.data.length > 2 * 1024 * 1024)
    throw new TypeError('Signature images and certificates must be 2 MiB or smaller');
  if (kind === 'image') {
    validateImage(file);
    // Bound PNG decompression before pdf-lib allocates a pixel buffer in its worker.
    const bytes = Buffer.from(file.data);
    if (bytes[0] === 137 && (bytes.length < 24 || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20) || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16_000_000))
      throw new TypeError('Signature images must contain at most 16 million pixels');
  }
  else if (typeof file.name !== 'string' || /[/\\\0]/.test(file.name) || !/\.(p12|pfx)$/i.test(file.name))
    throw new TypeError('Choose a PKCS#12 certificate (.p12 or .pfx)');
}

export function decodeRuntimeInputs(value = {}, nodes) {
  assertRecord(value, 'Runtime inputs');
  const result = Object.create(null);
  let totalBytes = 0;
  for (const [id, context] of Object.entries(value)) {
    if (!nodes.some(node => node.id === id)) throw new TypeError('Runtime inputs must reference existing nodes');
    assertRecord(context, 'Runtime input');
    if (Object.keys(context).some(key => !['secrets', 'attachment'].includes(key))) throw new TypeError('Unknown runtime input');
    const secrets = context.secrets || {};
    assertRecord(secrets, 'Secrets');
    if (Object.keys(secrets).some(key => !['password', 'ownerPassword', 'certificatePassword'].includes(key))) throw new TypeError('Unknown credential');
    for (const [key, secret] of Object.entries(secrets)) validatePassword(secret, key, { optional: key !== 'password' });
    result[id] = { secrets: { ...secrets } };
    if (context.attachment) {
      const file = context.attachment;
      if (typeof file.data !== 'string' || file.data.length > 3 * 1024 * 1024 || Buffer.from(file.data, 'base64').toString('base64') !== file.data)
        throw new TypeError('Choose a valid signature image or certificate');
      const decoded = { name: file.name, data: Buffer.from(file.data, 'base64') };
      const kind = /\.(png|jpe?g)$/i.test(file.name) ? 'image' : 'certificate';
      validateAttachment(decoded, kind);
      totalBytes += decoded.data.length;
      if (totalBytes > 4 * 1024 * 1024) throw new TypeError('Runtime attachments must total at most 4 MiB');
      result[id].attachment = decoded;
    }
  }
  return result;
}
