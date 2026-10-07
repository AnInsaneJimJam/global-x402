import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { capabilities, commandSchema, commitSchema, DomainError, id, purchaseObservationSchema } from '../../packages/contracts/index.js';
import type { Actor } from '../../packages/contracts/index.js';
import type { Procurement } from '../../packages/procurement/service.js';
import { assignment, putRecipient, storeEvidence } from '../../packages/procurement/evidence.js';
import { escrowTerms } from '../../packages/procurement/settlement-view.js';
import { creEvidence, creResultSchema } from '../../packages/procurement/cre.js';
import { recordVerification } from '../worker/jobs/verify_evidence.js';

export function createApp(service: Procurement, sessions: ReadonlyMap<string, Actor>) {
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 });
  function actor(authorization: string | undefined) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const principal = sessions.get(token);
    if (!principal) throw new DomainError('DEV_AUTH_REQUIRED', 401, 'REAUTHORIZE');
    return principal;
  }
  app.setErrorHandler((error, request, reply) => {
    const domain = error instanceof DomainError ? error : null;
    const invalid = error instanceof z.ZodError;
    // Fastify's own request errors (415 media type, 413 body too large, …) are rejected inputs, not unknown effects.
    const status = (error as { statusCode?: unknown }).statusCode;
    const rejected = typeof status === 'number' && status >= 400 && status < 500 ? status : null;
    reply.code(domain?.status ?? (invalid ? 400 : rejected ?? 500)).send({ error: {
      code: domain?.code ?? (invalid ? 'INVALID_INPUT' : rejected ? 'INVALID_REQUEST' : 'INTERNAL_ERROR'),
      effectStatus: domain || invalid || rejected ? 'NOT_STARTED' : 'OUTCOME_UNKNOWN',
      recovery: domain?.recovery ?? (invalid || rejected ? 'CHANGE_INPUT' : 'RECONCILE'),
    }, requestId: request.id });
  });
  // Minimal dashboard (apps/web): static files, strict CSP, all data fetched from the same API.
  const web = (file: string) => readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8');
  const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";
  const page = web('index.html'), script = web('app.js'), style = web('app.css');
  app.get('/', async (_request, reply) => reply.header('content-security-policy', csp).header('x-content-type-options', 'nosniff')
    .type('text/html; charset=utf-8').send(page));
  app.get('/app.js', async (_request, reply) => reply.header('x-content-type-options', 'nosniff')
    .type('text/javascript; charset=utf-8').send(script));
  app.get('/app.css', async (_request, reply) => reply.header('x-content-type-options', 'nosniff').type('text/css; charset=utf-8').send(style));
  app.get('/v1/capabilities', async () => capabilities());
  app.get('/v1/capabilities/commands', async () => z.toJSONSchema(commandSchema));
  app.get('/v1/health', async () => ({ status: 'OK', scope: 'LOCAL_CONTROL_CONTRACT_ONLY' }));
  app.post('/v1/action-plans', async request => service.prepare(actor(request.headers.authorization), request.body));
  function commit(request: FastifyRequest, command: 'create_intent' | 'claim' | 'register_purchase' | 'submit_evidence' | 'review_evidence' | 'fund_escrow' | 'request_refund' | 'authorize_refund', orderId?: string) {
    const input = commitSchema.parse(request.body);
    const key = id.parse(request.headers['idempotency-key']);
    return service.act(actor(request.headers.authorization), input.planId, input.operationId,
      orderId ? { command, orderId } : { command }, key);
  }
  app.post('/v1/intents', async request => commit(request, 'create_intent'));
  app.post<{ Params: { id: string } }>('/v1/orders/:id/claims', async request => commit(request, 'claim', id.parse(request.params.id)));
  app.post<{ Params: { id: string } }>('/v1/orders/:id/purchase-attempts', async request => commit(request, 'register_purchase', id.parse(request.params.id)));
  app.post<{ Params: { id: string } }>('/v1/orders/:id/evidence', async request => commit(request, 'submit_evidence', id.parse(request.params.id)));
  app.post<{ Params: { id: string } }>('/v1/orders/:id/evidence-reviews', async request => commit(request, 'review_evidence', id.parse(request.params.id)));
  app.post<{ Params: { id: string } }>('/v1/orders/:id/funding', async request => commit(request, 'fund_escrow', id.parse(request.params.id)));
  app.post<{ Params: { id: string } }>('/v1/orders/:id/refund-requests', async request => commit(request, 'request_refund', id.parse(request.params.id)));
  app.post<{ Params: { id: string } }>('/v1/orders/:id/refund-authorizations', async request => commit(request, 'authorize_refund', id.parse(request.params.id)));
  // Track B: private recipient, funded-only assignment reveal and raw .eml evidence upload.
  app.put<{ Params: { ref: string } }>('/v1/recipients/:ref', async request =>
    putRecipient(service.store, actor(request.headers.authorization), request.params.ref, request.body));
  app.get<{ Params: { id: string } }>('/v1/orders/:id/escrow-terms', async request =>
    escrowTerms(service.store, actor(request.headers.authorization), request.params.id));
  app.get<{ Params: { id: string } }>('/v1/orders/:id/assignment', async request =>
    assignment(service.store, actor(request.headers.authorization), request.params.id));
  // Chainlink CRE verifier interface: the workflow fetches evidence + expected terms and posts its verdict back.
  // Separate credential (CRE_VERIFIER_TOKEN); disabled when unset. Verdicts are recorded as CRE_SIMULATION.
  const creAuth = (request: FastifyRequest) => {
    const expected = process.env.CRE_VERIFIER_TOKEN;
    if (!expected || expected.length < 32 || request.headers['x-cre-token'] !== expected) throw new DomainError('NOT_FOUND', 404);
  };
  app.get<{ Params: { id: string }; Querystring: { sha256?: string } }>('/v1/internal/cre/evidence/:id', async request => {
    creAuth(request);
    return creEvidence(service.store, id.parse(request.params.id), z.string().regex(/^[a-f0-9]{64}$/).parse(request.query.sha256));
  });
  app.post('/v1/internal/verification-results', async request => {
    creAuth(request);
    const body = creResultSchema.parse(request.body);
    const recorded = await recordVerification(service.store, body.orderId, body.sha256, body.result, 'CRE_SIMULATION');
    return { recorded };
  });
  // The 1 MB raw-email parser exists only inside this encapsulated scope; other routes keep 32 KB JSON.
  app.register(async scope => {
    scope.addContentTypeParser('message/rfc822', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_request, body, done) => done(null, body));
    scope.post<{ Params: { id: string } }>('/v1/orders/:id/evidence-uploads', async request => {
      if (!Buffer.isBuffer(request.body)) throw new DomainError('EVIDENCE_MUST_BE_MESSAGE_RFC822', 415, 'CHANGE_INPUT');
      return storeEvidence(service.store, actor(request.headers.authorization), request.params.id, request.body);
    });
  });
  app.get<{ Querystring: { after?: string } }>('/v1/orders', async request => service.opportunities(request.query.after ? id.parse(request.query.after) : ''));
  app.get<{ Params: { id: string } }>('/v1/orders/:id/control', async request =>
    service.inspect(actor(request.headers.authorization), id.parse(request.params.id)));
  app.get<{ Params: { id: string } }>('/v1/operations/:id', async request =>
    service.operation(actor(request.headers.authorization), id.parse(request.params.id)));
  app.get<{ Querystring: { after?: string } }>('/v1/work', async request => service.work(actor(request.headers.authorization), request.query.after ? id.parse(request.query.after) : ''));
  app.post<{ Params: { id: string } }>('/v1/orders/:id/purchase-observations', async request => {
    await service.observePurchase(actor(request.headers.authorization), id.parse(request.params.id), purchaseObservationSchema.parse(request.body));
    return { accepted: true, sourceType: 'ACTOR_REPORT', independentVerification: false };
  });
  return app;
}
