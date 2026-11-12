import React, { useEffect, useRef } from 'react';

export default function PdfControls({ operation, options, runtime, disabled, onOption, onRuntime, onError }) {
  const secrets = runtime?.secrets || {};
  const attachmentRead = useRef(0);
  useEffect(() => { attachmentRead.current++; return () => { attachmentRead.current++; }; }, [operation, options.mode]);
  const secret = (key, value) => onRuntime(current => ({ ...current, secrets: { ...current.secrets, [key]: value } }));
  const number = (key, label, fallback, min, max, step = 1) => <label key={key}>{label}<input type="number" aria-label={label}
    min={min} max={max} step={step} disabled={disabled} value={options[key] ?? fallback}
    onChange={event => onOption(key, event.target.value === '' ? undefined : Number(event.target.value))} /></label>;
  const password = (key, label, optional = false) => <label>{label}<input type="password" aria-label={label} autoComplete="off" maxLength={1024}
    value={secrets[key] || ''} required={!optional} disabled={disabled} onChange={event => secret(key, event.target.value)} /></label>;
  const attach = async event => {
    const generation = ++attachmentRead.current;
    const file = event.target.files[0];
    if (!file) return;
    if (!file.size || file.size > 2 * 1024 * 1024) return onError('Signature images and certificates must be 2 MiB or smaller.');
    try {
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      if (generation === attachmentRead.current) onRuntime(current => ({ ...current, attachment: { name: file.name, data } }));
    } catch { onError('Could not read the signature attachment.'); }
  };
  if (operation === 'pdf.reduce') return <div className="pdf-controls">
    {number('factor', 'Compression factor', 2, 1, 10, 0.1)}
    <small>2× requests half the original file size. Exact reduction depends on the PDF.</small>
    <label className="checkbox-setting"><input type="checkbox" aria-label="Auto quality" checked={options.autoQuality !== false} disabled={disabled}
      onChange={event => onOption('autoQuality', event.target.checked)} /><span>Auto quality</span></label>
    <p>Auto tries lossless compression first, then the highest quality profile that meets your target.</p>
    {options.autoQuality === false && <label>Image quality: {options.quality ?? 80}<input type="range" aria-label="Image quality" min="20" max="95" step="1"
      value={options.quality ?? 80} disabled={disabled} onChange={event => onOption('quality', Number(event.target.value))} /></label>}
    <p>Image quality and PDF features such as annotations or forms may change. The original is retained if no attempt is smaller. Results show actual savings and whether the target was reached.</p>
  </div>;
  if (['pdf.encrypt', 'pdf.decrypt'].includes(operation)) return <div className="pdf-controls">
    {password('password', operation === 'pdf.encrypt' ? 'Opening password' : 'PDF password')}
    {operation === 'pdf.encrypt' && password('ownerPassword', 'Owner password (optional)', true)}
    <small>Passwords stay in this session and are excluded from saved or exported workflows.</small>
  </div>;
  if (operation !== 'pdf.sign') return null;
  const certificate = options.mode === 'certificate';
  return <div className="pdf-controls">
    <label>Signing method<select aria-label="Signing method" disabled={disabled} value={options.mode || 'image'}
      onChange={event => { attachmentRead.current++; onOption('mode', event.target.value); onRuntime({}); }}>
      <option value="image">Visible signature image</option><option value="certificate">Certificate digital signature</option>
    </select></label>
    <label>{certificate ? 'Signing certificate' : 'Signature image'}<input type="file" aria-label={certificate ? 'Signing certificate' : 'Signature image'}
      accept={certificate ? '.p12,.pfx' : '.png,.jpg,.jpeg'} disabled={disabled} onChange={attach} /></label>
    {runtime?.attachment && <small>{runtime.attachment.name}</small>}
    {certificate ? <>
      {number('page', 'Signature field page', 1, 1, 1000)}
      {password('certificatePassword', 'Certificate password', true)}
      {['name', 'reason'].map(key => <label key={key}>{key === 'name' ? 'Signer name' : 'Signing reason'}<input type="text" maxLength={200} disabled={disabled}
        value={options[key] || ''} onChange={event => onOption(key, event.target.value)} /></label>)}
      <p>Creates an invisible digital signature. Reader trust depends on your certificate. Sign after all other PDF changes.</p>
    </> : <>
      {number('page', 'Signature page', 1, 1, 1000)}
      {number('x', 'Signature X (pt)', 36, 0, 14400)}{number('y', 'Signature Y (pt)', 36, 0, 14400)}
      {number('width', 'Signature width (pt)', 160, 1, 2000)}{number('height', 'Signature height (pt)', 60, 1, 2000)}
      <p>Places an image without a certificate signature. Coordinates use points from the page crop-box lower-left before rotation.</p>
    </>}
    <small>PNG/JPEG or PKCS#12 attachments: up to 2 MiB. Files and certificate passwords are excluded from saved workflows.</small>
  </div>;
}
