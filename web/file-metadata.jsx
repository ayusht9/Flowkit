import React from 'react';

export function metadataSummary(entry) {
  if (entry?.state === 'loading') return 'Reading metadata…';
  if (!entry?.metadata) return entry?.state === 'error' ? 'Metadata unavailable' : '';
  const { details, kind } = entry.metadata;
  if (kind === 'pdf') return details.encrypted ? 'Encrypted PDF' : details.pageCount ? `${details.pageCount} pages · PDF` : 'PDF';
  if (kind === 'image' && details.width) return `${details.width} × ${details.height} pixels`;
  if (details.durationSeconds !== undefined) return `${details.durationSeconds.toFixed(2)} seconds · ${kind}`;
  return entry.metadata.mimeType;
}

export default function FileMetadata({ entry, onRefresh }) {
  const report = entry?.metadata;
  const details = report?.details || {};
  const rows = report ? [['Format', report.mimeType], ['Size', `${report.sizeBytes.toLocaleString()} bytes`],
    ...(details.pageCount ? [['Pages', details.pageCount]] : []),
    ...(typeof details.encrypted === 'boolean' ? [['Encryption', details.encrypted ? 'Encrypted' : 'Not encrypted']] : []),
    ...['title', 'author', 'subject', 'creator', 'producer'].filter(key => details[key]).map(key => [key[0].toUpperCase() + key.slice(1), details[key]]),
    ...(details.width ? [['Dimensions', `${details.width} × ${details.height} pixels`]] : []),
    ...(details.bitDepth ? [['Bit depth', details.bitDepth]] : []), ...(details.colorspace ? [['Color space', details.colorspace]] : []),
    ...(details.durationSeconds !== undefined ? [['Duration', `${details.durationSeconds.toFixed(2)} seconds`]] : []),
    ...(details.container ? [['Container', details.container]] : []),
    ...(details.characterCount !== undefined ? [['Characters', details.characterCount], ['Lines', details.lineCount]] : []),
    ...(details.pages?.[0] ? [['First page', `${details.pages[0].widthPoints} × ${details.pages[0].heightPoints} pt`]] : []),
  ] : [];
  return <section className="inspector-section file-metadata" aria-label="File metadata" aria-busy={entry?.state === 'loading'}>
    <h4>File metadata</h4>
    {entry?.state === 'loading' && <p role="status">Reading file metadata…</p>}
    {entry?.state === 'error' && <p role="status">{entry.error}</p>}
    {!entry && <p>Upload a file to read its metadata automatically.</p>}
    {report && <>
      <dl>{rows.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
      {details.streams?.map((stream, index) => <p key={index}>{stream.type}: {stream.codec || 'unknown codec'}
        {stream.width ? ` · ${stream.width} × ${stream.height}` : ''}{stream.channels ? ` · ${stream.channels} channels` : ''}{stream.sampleRate ? ` · ${stream.sampleRate} Hz` : ''}</p>)}
      {report.warnings.map((warning, index) => <p className="metadata-warning" key={index}>{warning}</p>)}
    </>}
    {entry && <button className="button" disabled={entry.state === 'loading'} onClick={onRefresh}>Refresh metadata</button>}
  </section>;
}
