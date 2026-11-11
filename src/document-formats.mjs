// Shared, trusted format definitions for native execution, MCP and the editor.
export const documentReaders = Object.freeze({
  '.docx': 'docx', '.odt': 'odt', '.html': 'html', '.htm': 'html', '.epub': 'epub',
  '.md': 'commonmark', '.markdown': 'commonmark', '.txt': 'commonmark',
  '.rtf': 'rtf', '.tex': 'latex', '.rst': 'rst',
});
export const documentInputLabel = 'DOCX, ODT, HTML, EPUB, Markdown, TXT, RTF, LaTeX, RST';
export const documentConversions = [
  { target: 'html', type: 'document.toHtml', title: 'Convert to HTML', description: 'Create a standalone web document', section: 'Office', format: 'html5', extension: '.html', mimeType: 'text/html', arguments: ['--standalone'] },
  { target: 'docx', type: 'document.toDocx', title: 'Convert to Word', description: 'Create a Microsoft Word .docx file', section: 'Office', format: 'docx', extension: '.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { target: 'odt', type: 'document.toOdt', title: 'Convert to OpenDocument', description: 'Create an editable .odt file', section: 'Office', format: 'odt', extension: '.odt', mimeType: 'application/vnd.oasis.opendocument.text' },
  { target: 'epub', type: 'document.toEpub', title: 'Convert to EPUB', description: 'Create an EPUB 3 ebook', section: 'Office', format: 'epub3', extension: '.epub', mimeType: 'application/epub+zip' },
  { target: 'pdf', type: 'document.toPdf', title: 'Create PDF', description: 'Create a PDF using the installed pdfroff engine', section: 'PDF', format: 'pdf', extension: '.pdf', mimeType: 'application/pdf', arguments: ['--pdf-engine=pdfroff'] },
  { target: 'text', type: 'document.toText', title: 'Convert to plain text', description: 'Extract readable text into a .txt file', section: 'Text', format: 'plain', extension: '.txt', mimeType: 'text/plain', arguments: ['--wrap=none'] },
  { target: 'rtf', type: 'document.toRtf', title: 'Convert to RTF', description: 'Create a Rich Text Format document', section: 'Office', format: 'rtf', extension: '.rtf', mimeType: 'application/rtf', arguments: ['--standalone'] },
  { target: 'latex', type: 'document.toLatex', title: 'Convert to LaTeX', description: 'Export LaTeX source without compiling it', section: 'Markup', format: 'latex', extension: '.tex', mimeType: 'application/x-tex', arguments: ['--standalone'] },
  { target: 'rst', type: 'document.toRst', title: 'Convert to reStructuredText', description: 'Create reStructuredText source for documentation', section: 'Markup', format: 'rst', extension: '.rst', mimeType: 'text/x-rst', arguments: ['--wrap=none'] },
  { target: 'asciidoc', type: 'document.toAsciiDoc', title: 'Convert to AsciiDoc', description: 'Export structured AsciiDoc source', section: 'Markup', format: 'asciidoc', extension: '.adoc', mimeType: 'text/asciidoc', arguments: ['--wrap=none'] },
  { target: 'pptx', type: 'document.toPptx', title: 'Convert to PowerPoint', description: 'Create slides from headings; level-2 headings start slides', section: 'Slides', format: 'pptx', extension: '.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', arguments: ['--slide-level=2'] },
];
