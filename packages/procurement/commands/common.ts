import { DomainError } from '../../contracts/index.js';
import type { Order } from '../../contracts/index.js';

export function fail(code: string, status = 409): never { throw new DomainError(code, status); }
export function requireOrder(order: Order | null): Order { return order ?? fail('NOT_FOUND', 404); }
