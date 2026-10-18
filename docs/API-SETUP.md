# Add the OpenAI key manually

The LLM integration is implemented, and the user has manually configured the hosted Worker secret. For a new deployment without a key, the complete rule-based workflow and professional PDF work; **Refine with AI** stays disabled.

## Hosted website — paste it here

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/2aa82d87fe21472b7c89953238f0cf6f/workers-and-pages).
2. Select the **bill-buster** Worker.
3. Go to **Settings → Variables and Secrets → Add**.
4. Set **Type** to **Secret**.
5. Set **Variable name** to **OPENAI_API_KEY**.
6. Paste your OpenAI API key into **Value**, then **Deploy** (or save and deploy the prompted Worker update).
7. Refresh https://billbuster.ankitkapoor.me. Complete a review, choose **Prepare my inquiry**, then **Refine with AI**.

The default model is **gpt-5.4-mini**, configured as the non-secret `OPENAI_MODEL` variable. The OpenAI project must have API billing and model access. A ChatGPT subscription alone does not supply API credits.

Alternative from the repository terminal: `npx wrangler secret put OPENAI_API_KEY`. Paste only at the interactive prompt. Do not place the key in `wrangler.jsonc`, browser files or Git.

## Local development

Copy `.dev.vars.example` to `.dev.vars` in this repository. Paste the key after the equals sign on its `OPENAI_API_KEY=` line. This file is ignored by Git. Run `npm run dev` and open http://localhost:8001. A local `.env` file does not configure the deployed Worker.

## What the LLM adds

The optional button rewrites the inquiry into accessible explanations and focused documentation requests for each confirmed finding. It does not detect coding errors or choose rates. Duplicate, MUE and NCCI checks remain deterministic; the Worker reruns them from confirmed bill fields instead of trusting browser-supplied findings.

Only generated finding details/questions and evidence IDs go to OpenAI. The PDF, patient/account fields, descriptions, provider labels, payer/plan and edited letter are not sent to OpenAI. The confirmed structured bill does travel to the Worker when you press the button. Bill Buster has no review database and does not log request bodies; the Responses request uses `store:false`. This is still a synthetic-only prototype, not an assertion of zero provider retention or suitability for patient data.

Structured output is checked for complete finding IDs, duplicate/missing items, numbers, links and unsupported assertions. Code inserts the confirmed facts and evidence. These checks do not establish that every possible AI sentence is correct; review the wording. Failure, refusal or unavailable service keeps the original template. Per-client and shared limits cap requests to five per minute per Cloudflare location; the endpoint rejects cross-origin requests and limits request size. This is prototype abuse protection, not account authentication or a global spending cap. Set a project budget in OpenAI before enabling public AI access.

## Verification status

Tests mock the OpenAI Responses API and check payloads, privacy filtering, fact preservation, failures and endpoint protection. Live synthetic refinement has also been verified against the hosted Worker after manual key setup. A new deployment still needs its own key and a successful end-to-end call. Configuration status is available at `/api/status`; it reports only whether a key is present and the model name, never the secret or a successful billing/access check.

References: [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [model](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
