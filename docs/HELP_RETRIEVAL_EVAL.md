# GPT-4o-mini help retrieval experiment

This standalone planning experiment does not add natural-language input to the app or change MCP tools. It compares four fixed media operation definitions, those definitions plus installed FFmpeg help, and lexical retrieval of definitions plus help excerpts. It tests video trimming, a trim/extract chain, and rejection of an unsupported loudness operation.

Run the offline checks and inspect request sizes without calling OpenAI:

```sh
node --test test/help-retrieval-eval.test.mjs
node scripts/eval-help-retrieval.mjs
```

For a live test, put `OPENAI_API_KEY` in the environment or ignored `.env.local`, then run:

```sh
node scripts/eval-help-retrieval.mjs --live
```

The live test makes exactly nine requests on a successful run to the official OpenAI Responses endpoint using `gpt-4o-mini`, with at most 800 output tokens per request and no retries. It stops on API/network errors. Only synthetic tasks, operation descriptions and installed FFmpeg help are sent. No workspace files or generated commands are executed. Responses use a strict JSON schema and are checked against the existing operation registry and expected task parameters. Model responses are not stored by the Responses API (`store: false`); this does not change other provider retention policies.

JSON reports under ignored `.flowkit-artifacts/evals/` contain API-reported tokens, per-request latency, resolved model, correctness and normalized steps. No key is written to the reports. FFmpeg must be installed; `FFMPEG_PATH` can select its executable.

This is a small planning pilot, not an end-to-end RAG benchmark: it uses lexical overlap rather than embeddings, no reranker/compressor, and no native media execution. All four operation IDs appear in the common output schema, so schema scaling is not measured. Three cases with one sample each cannot establish general reliability. The fixed-definition baseline is deliberately included: retrieval can cost more than compact schemas for a small catalog. Compare correctness as well as tokens, and measure host conversation overhead, larger catalogs, repeated-workflow reuse and real outputs before claiming production savings.

API format reference: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
