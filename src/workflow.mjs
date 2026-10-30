import { OperationRegistry, assertRecord } from "./operations.mjs";
import { createDocumentConversion, createDocumentMerge, createDocumentToMarkdown } from "./document.mjs";
import { createImageResize, validateImage } from "./image.mjs";
import { createMediaOperation, validateMedia } from "./media.mjs";

export function createWorkflowRegistry({ executable = "pandoc", imageExecutable, ffmpeg, ffprobe } = {}) {
  const convert = createDocumentToMarkdown({ executable });
  const markdown = (value) => {
    assertRecord(value, "Markdown");
    if (typeof value.text !== "string" || typeof value.source !== "string")
      throw new TypeError("Expected Markdown text and source");
  };
  const registry = new OperationRegistry();
  for (const type of ["audio", "video"]) {
    for (const action of ["upload", "pipe", "preview"])
      registry.register(`${type}.${action}`, { inputType: type, outputType: type, validateInput: (value) => validateMedia(value, type), run: async (input) => input });
  }
  for (const operation of ["audio.convert", "audio.trim", "video.trim", "video.extractAudio"])
    registry.register(operation, createMediaOperation(operation, { ffmpeg, ffprobe }));
  return registry
    .register("document.pipe", { inputType: "document", outputType: "document", validateInput: convert.validateInput, run: async (input) => input })
    .register("markdown.pipe", { inputType: "markdown", outputType: "markdown", validateInput: markdown, run: async (input) => input })
    .register("image.pipe", { inputType: "image", outputType: "image", validateInput: validateImage, run: async (input) => input })
    .register("image.upload", {
      inputType: "image", outputType: "image", validateInput: validateImage,
      run: async (input) => input,
    })
    .register("image.resize", createImageResize({ executable: imageExecutable }))
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
    .register("document.toHtml", createDocumentConversion("html", { executable }))
    .register("document.toDocx", createDocumentConversion("docx", { executable }))
    .register("document.toOdt", createDocumentConversion("odt", { executable }))
    .register("document.toEpub", createDocumentConversion("epub", { executable }))
    .register("document.toPdf", createDocumentConversion("pdf", { executable }))
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
