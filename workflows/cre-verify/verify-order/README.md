# verify-order (Chainlink CRE, Confidential Workflow)

Verifies a filler's order-confirmation email inside a CRE **TEE enclave** (`cre.handlerInTee`, AWS Nitro). The email carries the buyer's name and address; in a confidential workflow the email, the coordinator token (released by the Vault DON into the attested enclave) and the per-check observations never reach node operators. Only the verdict leaves the enclave. Local `cre workflow simulate` emulates the enclave (not a real TEE); deploying needs Chainlink's Confidential Workflows private beta. HTTP trigger payload: `{ "orderId": "...", "sha256": "..." }`.

The enclave fetches the evidence and expected terms from the coordinator (`GET /v1/internal/cre/evidence/:id`), resolves the
merchant's DKIM key over DNS-over-HTTPS, and runs the shared dependency-free verifier (`packages/verification/pure.ts`).
The verdict is posted from the enclave to `POST /v1/internal/verification-results`.

The worker runs this automatically when `VERIFIER=CRE` (needs `CRE_VERIFIER_TOKEN` in the root `.env`). Manual run:

```bash
cd workflows/cre-verify
cre workflow simulate verify-order --non-interactive --trigger-index 0 --skip-type-checks --target staging-settings \
  --http-payload '{"orderId":"<order id>","sha256":"<evidence sha256>"}' -e ../../.env
```
