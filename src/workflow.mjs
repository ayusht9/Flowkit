import { OperationRegistry, assertRecord } from "./operations.mjs";
import { createDocumentToMarkdown } from "./document.mjs";

export function createWorkflowRegistry({ executable = "pandoc" } = {}) {
  const convert = createDocumentToMarkdown({ executable });
  const markdown = (value) => {
    assertRecord(value, "Markdown");
    if (typeof value.text !== "string" || typeof value.source !== "string")
      throw new TypeError("Expected Markdown text and source");
  };
  return new OperationRegistry()
    .register("file.upload", {
      inputType: "document",
      outputType: "document",
      validateInput: convert.validateInput,
      run: async (input) => input,
    })
    .register("document.toMarkdown", convert)
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
