# Help retrieval experiment

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

To use GPT-5 nano instead:

```sh
node scripts/eval-help-retrieval.mjs --live --model gpt-5-nano
```

The live test makes exactly nine requests on a successful run to the official OpenAI Responses endpoint. The default `gpt-4o-mini` uses temperature zero and at most 800 output tokens per request. Explicit `--model gpt-5-nano` uses minimal reasoning, no temperature setting, and at most 2000 output tokens per request (including reasoning). Model IDs are never substituted automatically. Reports record settings and actual model IDs. Embedding models are not planners; this experiment does not call them.

There are no retries, and the test stops on API/network errors. Only synthetic tasks, operation descriptions and installed FFmpeg help are sent. No workspace files or generated commands are executed. Responses use a strict JSON schema and are checked against the existing operation registry and expected task parameters. Model responses are not stored by the Responses API (`store: false`); this does not change other provider retention policies.

JSON reports under ignored `.flowkit-artifacts/evals/` contain API-reported tokens, per-request latency, resolved model, correctness and normalized steps. No key is written to the reports. FFmpeg must be installed; `FFMPEG_PATH` can select its executable.

This is a small planning pilot, not an end-to-end RAG benchmark: it uses lexical overlap rather than embeddings, no reranker/compressor, and no native media execution. All four operation IDs appear in the common output schema, so schema scaling is not measured. Three cases with one sample each cannot establish general reliability. The fixed-definition baseline is deliberately included: retrieval can cost more than compact schemas for a small catalog. Compare correctness as well as tokens, and measure host conversation overhead, larger catalogs, repeated-workflow reuse and real outputs before claiming production savings.

API format reference: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## First GPT-5 nano pilot

The nine-call run resolved to `gpt-5-nano-2025-08-07` with minimal reasoning. Actual API usage across three tasks per mode:

| Mode | Correct plans | Input tokens | Output tokens | Total tokens |
| --- | --- | --- | --- | --- |
| Fixed registry | 2/3 | 1180 | 165 | 1345 |
| Full help | 1/3 | 12541 | 205 | 12746 |
| Retrieved help | 1/3 | 2098 | 205 | 2303 |

All modes handled the single video trim correctly. The registry-only chain used 100 seconds instead of the requested 10. Both help-based chains failed type compatibility checks. Only the registry mode correctly rejected unsupported loudness normalization; both help modes produced invalid trim parameters. Invalid plans were not executed. The evaluation exits unsuccessfully when correctness checks fail, even when every API call completes.

Retrieved help used 81.9% fewer total tokens than full help, but 71.2% more than the small fixed registry. These are observed token counts, not billing or successful-task cost estimates. No embedding calls, repeated samples, retries, or reasoning-setting comparisons were performed. This result supports testing deterministic saved workflows and compact registry discovery first; it does not establish that GPT-5 nano or RAG generally fails these tasks. Raw reports remain local under `.flowkit-artifacts/evals/`.
