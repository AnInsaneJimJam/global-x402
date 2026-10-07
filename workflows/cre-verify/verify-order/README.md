# verify-order (Chainlink CRE)

Verifies a filler's order-confirmation email on CRE. HTTP trigger payload: `{ "orderId": "...", "sha256": "..." }`.

Each node fetches the evidence and expected terms from the coordinator (`GET /v1/internal/cre/evidence/:id`), resolves the
merchant's DKIM key over DNS-over-HTTPS, and runs the shared dependency-free verifier (`packages/verification/pure.ts`).
Nodes must agree on the identical verdict, which is posted to `POST /v1/internal/verification-results`.

The worker runs this automatically when `VERIFIER=CRE` (needs `CRE_VERIFIER_TOKEN` in the root `.env`). Manual run:

```bash
cd workflows/cre-verify
cre workflow simulate verify-order --non-interactive --trigger-index 0 --skip-type-checks --target staging-settings \
  --http-payload '{"orderId":"<order id>","sha256":"<evidence sha256>"}' -e ../../.env
```
