import type { CheckoutAdapter } from './index.js';

export type Ask = (question: string) => Promise<string>;
const ORDER_ID = /^[A-Za-z0-9_-]{3,64}$/;

// Human-assisted checkout: the filler places the order on their own merchant account and reports the
// merchant order number. Anything other than a well-formed number is treated as an UNKNOWN outcome,
// which blocks a second checkout until reconciled (the runtime never re-buys on a guess).
export function humanCheckout(ask: Ask, instructions: () => string): CheckoutAdapter {
  return {
    environment: 'LIVE',
    async place() {
      const answer = (await ask(`${instructions()}\nPlace the order now. Enter the merchant order number, or "unsure" if you cannot tell whether it went through: `)).trim();
      if (!ORDER_ID.test(answer) || answer.toLowerCase() === 'unsure') throw new Error('PURCHASE_OUTCOME_UNKNOWN');
      return { merchantOrderId: answer };
    },
    async lookup() {
      const answer = (await ask('A previous checkout may have gone through. Check your merchant order history and enter the order number, or "none" if there is no order: ')).trim();
      // "none" is not proof that nothing was bought, so the purchase stays UNKNOWN (blocked) rather than retryable.
      return ORDER_ID.test(answer) && answer.toLowerCase() !== 'none' ? { state: 'ORDERED', merchantOrderId: answer } : { state: 'UNKNOWN' };
    },
  };
}
