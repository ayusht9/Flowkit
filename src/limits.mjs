export const MiB = 1024 * 1024;

// Trusted process configuration only; never a workflow or MCP argument.
export function getMediaOutputMiB(value = process.env.FLOWKIT_MEDIA_MAX_OUTPUT_MIB ?? 8) {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256)
    throw new TypeError('FLOWKIT_MEDIA_MAX_OUTPUT_MIB must be an integer between 1 and 256');
  return limit;
}
