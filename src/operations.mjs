export function assertRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertPayload(payload, expectedType) {
  assertRecord(payload, 'Payload');
  if (payload.type !== expectedType || !Object.hasOwn(payload, 'value')) {
    throw new TypeError(`Expected a payload with type "${expectedType}" and a value`);
  }
}

// Validators throw on invalid data; operation implementations are trusted server code.
export class OperationRegistry {
  #operations = new Map();

  register(type, definition) {
    if (typeof type !== 'string' || !type.trim() || this.#operations.has(type)) {
      throw new TypeError('Operation type must be a unique, nonempty string');
    }
    assertRecord(definition, 'Operation definition');
    for (const field of ['inputType', 'outputType']) {
      if (typeof definition[field] !== 'string' || !definition[field].trim()) {
        throw new TypeError(`${type}.${field} must be a nonempty string`);
      }
    }
    if (typeof definition.run !== 'function') {
      throw new TypeError(`${type}.run must be a function`);
    }
    for (const field of ['validateOptions', 'validateInput', 'validateOutput']) {
      if (definition[field] !== undefined && typeof definition[field] !== 'function') {
        throw new TypeError(`${type}.${field} must be a function`);
      }
    }
    this.#operations.set(type, Object.freeze({ ...definition }));
    return this;
  }

  get(type) {
    const operation = this.#operations.get(type);
    if (!operation) throw new TypeError(`Unknown operation: ${type}`);
    return operation;
  }

  validateOptions(type, options = {}) {
    assertRecord(options, 'Options');
    const operation = this.get(type);
    if (operation.validateOptions) operation.validateOptions(options);
    else if (Object.keys(options).length) {
      throw new TypeError(`${type} does not accept options`);
    }
  }

  async execute(type, input, options = {}, { signal } = {}) {
    const operation = this.get(type);
    this.validateOptions(type, options);
    assertPayload(input, operation.inputType);
    operation.validateInput?.(input.value);
    signal?.throwIfAborted();
    const output = await operation.run(input, options, { signal });
    signal?.throwIfAborted();
    assertPayload(output, operation.outputType);
    operation.validateOutput?.(output.value);
    return output;
  }
}
