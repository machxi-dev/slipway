# D4. Refunds

- Status: in progress
- Records: [0003](../adr/0003-money.md), [0005](../adr/0005-queue.md)
- CI: at-ship
- Branch: `lane/D4`

Refund part of an order.

## Done when

- [ ] `slipway run gate` is green.

## Steps

### 1. The refund model

- [x] Built
- Done when: `refund.test › rounds down` passes
- Records: [0003](../adr/0003-money.md)
- Paths: src/refunds/**

### 2. The refund endpoint

- [ ] Built
- Done when: `api.test › POST /refunds` passes <!-- a comment -->
- Paths: src/api/**, web/refunds/**

## Asked at scope

- CI: at-ship.
