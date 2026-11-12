import { OperationRegistry, assertRecord } from "./operations.mjs";
import { createDocumentConversion, createDocumentMerge, createDocumentToMarkdown } from "./document.mjs";
import { createImageOperation, validateImage } from "./image.mjs";
import { imageOperations } from "./image-operations.mjs";
import { documentConversions } from './document-formats.mjs';
import { mediaOperations } from './media-operations.mjs';
import { getMediaOutputMiB, MiB } from './limits.mjs';
import { createMediaOperation, validateMedia } from "./media.mjs";
import { createPdfOperation, validatePdf } from './pdf.mjs';

export function createWorkflowRegistry({ executable = "pandoc", imageExecutable, ffmpeg, ffprobe, qpdf, mediaOutputMiB = getMediaOutputMiB() } = {}) {
  mediaOutputMiB = getMediaOutputMiB(mediaOutputMiB);
  const mediaPayloadBytes = Math.max(20, mediaOutputMiB) * MiB;
  const convert = createDocumentToMarkdown({ executable });
  const markdown = (value) => {
    assertRecord(value, "Markdown");
    if (typeof value.text !== "string" || typeof value.source !== "string")
      throw new TypeError("Expected Markdown text and source");
  };
  const registry = new OperationRegistry();
  for (const operation of ['pdf.merge', 'pdf.extract', 'pdf.rotate'])
    registry.register(operation, createPdfOperation(operation, { executable: qpdf }));
  for (const action of ['upload', 'pipe', 'preview'])
    registry.register(`pdf.${action}`, { inputType: 'pdf', outputType: 'pdf', validateInput: validatePdf, run: async input => input });
  for (const type of ["audio", "video"]) {
    for (const action of ["upload", "pipe", "preview"])
      registry.register(`${type}.${action}`, { inputType: type, outputType: type, validateInput: (value) => validateMedia(value, type, {
        maxBytes: action === 'upload' ? 20 * MiB : action === 'preview' ? mediaOutputMiB * MiB : mediaPayloadBytes,
      }), run: async (input) => input });
  }
  for (const operation of mediaOperations)
    registry.register(operation.type, createMediaOperation(operation.type, { ffmpeg, ffprobe, maxOutputMiB: mediaOutputMiB }));
  for (const operation of imageOperations)
    registry.register(operation.type, createImageOperation(operation.type, { executable: imageExecutable }));
  for (const operation of documentConversions)
    registry.register(operation.type, createDocumentConversion(operation.target, { executable }));
  return registry
    .register("document.pipe", { inputType: "document", outputType: "document", validateInput: convert.validateInput, run: async (input) => input })
    .register("markdown.pipe", { inputType: "markdown", outputType: "markdown", validateInput: markdown, run: async (input) => input })
    .register("image.pipe", { inputType: "image", outputType: "image", validateInput: validateImage, run: async (input) => input })
    .register("image.upload", {
      inputType: "image", outputType: "image", validateInput: validateImage,
      run: async (input) => input,
    })
    .register("image.preview", {
      inputType: "image", outputType: "image", validateInput: validateImage,
      run: async (input) => input,
    })
    .register("file.upload", {
      inputType: "document",
      outputType: "document",
      validateInput: convert.validateInput,
      run: async (input) => input,
    })
    .register("document.toMarkdown", convert)
    .register("document.merge", createDocumentMerge({ executable }))
    .register("document.preview", { inputType: "document", outputType: "document", run: async (input) => input })
    .register("context.clean", {
      inputType: "markdown",
      outputType: "markdown",
      validateInput: markdown,
      validateOutput: markdown,
      validateOptions(options) {
        if (
          Object.keys(options).some((key) => key !== "collapseBlankLines") ||
          (options.collapseBlankLines !== undefined &&
            typeof options.collapseBlankLines !== "boolean")
        ) {
          throw new TypeError("collapseBlankLines must be a boolean");
        }
      },
      run: async (input, options) => {
        let text = input.value.text
          .replace(/\r\n?/g, "\n")
          .replace(/^\n+|\n+$/g, "");
        // shortcut: preserve spacing throughout code-containing documents; use a Markdown parser for finer cleanup.
        const hasCode = /^ {0,3}(?:`{3,}|~{3,})|^(?: {4}|\t)/m.test(text);
        if (options.collapseBlankLines !== false && !hasCode)
          text = text.replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, "\n\n");
        return {
          type: "markdown",
          value: { ...input.value, text: `${text}\n` },
        };
      },
    })
    .register("artifact.preview", {
      inputType: "markdown",
      outputType: "markdown",
      validateInput: markdown,
      run: async (input) => input,
    });
}
