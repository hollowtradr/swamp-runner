# $YODA Extra-Play Spec

**Decision (Grant 2026-05-29):** Wire $YODA jetton as a second payment option
for extra plays alongside TON. Tiny price, transferred to a burn-treasury,
narrative = "tribute to Yoda, burned forever." Promotes the token on the
Yoda Planet without creating perverse "spend to lose your tier" incentives.

## Locked-in decisions

| Knob | Value | Why |
|---|---|---|
| Price | **50 $YODA** | ≈0.5 % of Knight threshold (10k). Symbolic, can't threaten any holder's tier in one session. |
| Destination | dedicated **burn-treasury wallet** (`ARCADE_YODA_BURN_TREASURY`) | Tokens accumulate there, auto-burned by treasury sweeper (out of MVP scope). Same deflationary signal. |
| TON price | unchanged (0.3 TON) | TON remains the no-tier-impact option for whales. |
| Wallet binding required? | yes | same JIT prompt as TON path |
| Tier protection | none (intentional) | 50 is too small to drop a tier; if you're below Initiate you don't have a tier to lose anyway |

## Architecture (mirror of TON path)

```
Game (swamp-runner)                      Backend (babyyoda-bot)
─────────────────────                    ───────────────────────
ResultScreen "Pay 50 $YODA"
        │
        ▼
sdk.requestPurchase('extra_play',        POST /arcade/v0/purchase
   'extra_play', 50_000_000_000,    ───▶   (price = 50 YODA in nano-units)
   'Extra play', 'YODA')                  returns: {
        │                                   purchase_id,
        │                                   status: 'awaiting_payment',
        │                                   yoda_payment: {                    ◀── NEW BLOCK
        │                                     jetton_master,
        │                                     to_owner: burn_treasury,
        │                                     amount_nano: '50000000000',
        │                                     comment: 'sg_<short_id>',
        │                                     valid_until: <ts>,
        │                                     forward_ton_amount: '1000000'
        │                                   }
        │                                 }
        ▼
walletRpc('requestYodaPayment',          (shell builds jetton transfer
   {purchase_id, yoda_payment})           message, signs via TonConnect)
        │
        │   ✓ user signs Tonkeeper modal
        ▼
POST /arcade/v0/purchase/<id>/submit-tx  marks paid_pending
        │
        ▼
poll /arcade/v0/purchase/<id>            ton_payment_confirm worker
                                          scans burn-treasury jetton
                                          inbound msgs, matches comment,
                                          flips → 'paid'
        ▼
extra play granted on submit
```

## File-by-file changes

### Layer 1: Backend (`projects/babyyoda-bot`)

#### `app/api/arcade.py` — `route_create_purchase`

Add a YODA branch that mirrors the TON branch. Drop in around line 893 next
to the existing `if currency == "TON":` block.

```python
elif currency == "YODA":
    burn_treasury = os.getenv("ARCADE_YODA_BURN_TREASURY", "").strip()
    jetton_master = (
        os.getenv("YODA_JETTON_MASTER", "").strip()
        or os.getenv("BABYYODA_TON_CONTRACT", "").strip()
    )
    if not burn_treasury or not jetton_master:
        LOGGER.error("YODA payments not configured (treasury=%r master=%r)",
                     bool(burn_treasury), bool(jetton_master))
        return _err("YODA payments not configured", 503)
    if price <= 0:
        return _err("YODA purchase price must be > 0 nano", 400)
    comment_payload = f"sg_{purchase_id[-12:]}"
    valid_until = int(_time_mod.time()) + 120
    yoda_payment_block = {
        "jetton_master": jetton_master,
        "to_owner": burn_treasury,
        "amount_nano": str(price),          # YODA has 9 decimals (verify)
        "comment": comment_payload,
        "valid_until": valid_until,
        "forward_ton_amount": "1000000",    # 0.001 TON for forward msg
    }
    initial_status = "awaiting_payment"
```

Add `yoda_payment` to the response dict (None for non-YODA, mirror of
existing `ton_payment` key).

Update the legacy `payment_url` fallback so it's None for both YODA and TON
(only Stars uses the stub URL now).

#### `app/jobs/ton_payment_confirm.py` → split or branch

Rename concept: it now also confirms YODA. Two options:
- (preferred) Add a sibling worker `yoda_payment_confirm.py` that polls the
  burn-treasury's **jetton transfers** endpoint:
  `https://tonapi.io/v2/accounts/{burn_treasury}/jettons/{jetton_master}/history`
  and matches the inbound text comment to a pending YODA purchase.
- (or) Extend the existing worker with a YODA branch. DRYer but couples.

Pick whichever lands faster. Schema reference for jetton history endpoint:
https://docs.tonconsole.com/tonapi/rest-api/accounts (events with jetton_transfer).

The match logic is identical to TON: comment → pending purchase row →
verify amount ≥ expected → mark paid.

#### DB

No schema changes needed. `arcade_purchases.currency` already accepts
`'YODA'`. `comment_payload`, `tx_hash`, `amount_nanoton` columns work as-is.
(`amount_nanoton` will hold YODA nano-units; column name is historical.)

#### Env vars to add (Fly secrets)

```
ARCADE_YODA_BURN_TREASURY=UQ...      # NEW — Grant creates this wallet
YODA_JETTON_MASTER=...               # may already exist via BABYYODA_TON_CONTRACT
```

### Layer 2: Platform shell (`projects/babyyoda-bot/mini-app`)

#### `lib/walletRpc.ts` — add `requestYodaPayment` case

Mirror the existing `requestTonPayment` case (around line 261). Differences:

1. **Build jetton transfer payload** instead of plain transfer with text
   comment. Use `@ton/core` to construct:
   ```ts
   const transferOp = 0x0f8a7ea5;            // jetton transfer
   const queryId = BigInt(Date.now());
   const amount = BigInt(yp.amount_nano);
   const destination = Address.parse(yp.to_owner);
   const responseDestination = Address.parse(payerAddress);
   const forwardTonAmount = BigInt(yp.forward_ton_amount);
   const forwardPayload = beginCell()
     .storeUint(0, 32)                       // text comment op
     .storeStringTail(yp.comment)
     .endCell();
   const body = beginCell()
     .storeUint(transferOp, 32)
     .storeUint(queryId, 64)
     .storeCoins(amount)
     .storeAddress(destination)
     .storeAddress(responseDestination)
     .storeBit(false)                        // no custom payload
     .storeCoins(forwardTonAmount)
     .storeBit(true)                         // forward payload as ref
     .storeRef(forwardPayload)
     .endCell();
   const payloadB64 = body.toBoc().toString('base64');
   ```

2. **Derive payer's jetton wallet address** from owner + master. Use
   `@ton/core` and call the jetton master's `get_wallet_address` method
   via tonapi.io: `GET /v2/blockchain/accounts/{master}/methods/get_wallet_address`
   with the owner address as the BoC-encoded slice param. Easier:
   `GET /v2/accounts/{owner}/jettons/{master}` returns
   `{wallet_address: {address: "..."}}` — use that.

3. **Send transaction** to the payer's jetton wallet (not the master, not
   the burn treasury directly):
   ```ts
   await tc.sendTransaction({
     validUntil: yp.valid_until,
     messages: [{
       address: payerJettonWalletAddress,
       amount: '50000000',                   // 0.05 TON for jetton tx fees
       payload: payloadB64,
     }],
   });
   ```

4. **submit-tx** to backend identical to TON path (same endpoint, same
   payer_address field).

Imports needed (already in mini-app since TonConnect uses `@ton/core`):
```ts
import { Address, beginCell } from '@ton/core';
```

### Layer 3: Game SDK (`projects/swamp-runner/src/sdk.ts`)

#### Add `YodaPaymentBlock` type next to `TonPaymentBlock` (line 174)

```ts
export interface YodaPaymentBlock {
  jetton_master: string;
  to_owner: string;
  amount_nano: string;
  comment: string;
  valid_until: number;
  forward_ton_amount: string;
}
```

#### Add to `PurchaseData` (line 181)

```ts
yoda_payment: YodaPaymentBlock | null;
```

#### Add YODA branch to `requestPurchase` (after the TON branch, ~line 605)

Identical shape to TON branch, just:
- Read `created.data.yoda_payment` instead of `ton_payment`
- Call `walletRpc('requestYodaPayment', { purchase_id, yoda_payment: yp })`
- Return same `paid_pending` shape

### Layer 4: Game UI (`projects/swamp-runner/src/ui/ResultScreen.ts`)

#### Add second purchase pill next to existing `#extra-play-purchase`

Around the existing TON button (line 343), render a second button:

```html
<button id="extra-play-purchase-yoda" class="btn-secondary">
  <picture><source srcset="/sprites/v4/yoda_coffee.webp" .../>...</picture>
  Pay 50 $YODA — burned forever 🔥
</button>
```

Wire it identically to the TON button but call:
```ts
const resp = await sdk.requestPurchase(
  'extra_play',
  'extra_play',
  50_000_000_000,                  // 50 YODA × 1e9 nano-units
  'Extra play (burned)',
  'YODA',
);
```

Same `stashPendingExtraPlay` + `decrementPaidPlaysRemaining(1)` flow on
success.

#### Copy

For the YODA button, the tagline is "burned forever 🔥" (or similar). For
TON, keep current "Extra play" copy.

## Acceptance criteria

1. `POST /arcade/v0/purchase` with `currency: 'YODA'` returns a row with
   `status: 'awaiting_payment'` and a populated `yoda_payment` block.
2. `requestYodaPayment` shell RPC opens Tonkeeper, user signs, the BoC
   returns, backend marked `paid_pending`.
3. Jetton confirmation worker runs every 10s, finds the inbound transfer
   to the burn treasury with the matching comment, marks row `paid`.
4. Game polls and grants the extra play.
5. Refresh /session — `paid_plays_remaining` reflects backend truth.
6. End-to-end on prod with a small real $YODA balance.

## Out of scope (separate PR)

- Actual burn op on the treasury wallet (treasury just holds; sweep later).
- Stars flow.
- YODA price discovery / dynamic pricing.
- Per-tier YODA discount.

## File-edit checklist

- [x] `projects/babyyoda-bot/app/api/arcade.py` — add YODA branch to `route_create_purchase` (around line 893)
- [x] `projects/babyyoda-bot/app/api/arcade.py` — add `yoda_payment` to response dict
- [x] `projects/babyyoda-bot/app/jobs/yoda_payment_confirm.py` — new worker file
- [x] `projects/babyyoda-bot/app/jobs/__init__.py` or `app/bot.py` — schedule the worker
- [x] `projects/babyyoda-bot/app/db.py` — add `arcade_list_pending_yoda_purchases` + `arcade_expire_stale_yoda_purchases` (or generalize TON ones via currency param)
- [x] `projects/babyyoda-bot/tests/test_arcade_v0.py` — add YODA purchase test
- [x] `projects/babyyoda-bot/mini-app/lib/walletRpc.ts` — add `requestYodaPayment` case
- [x] `projects/babyyoda-bot/mini-app/lib/walletRpc.ts` — add jetton wallet address derivation helper
- [x] `projects/swamp-runner/src/sdk.ts` — add `YodaPaymentBlock` type
- [x] `projects/swamp-runner/src/sdk.ts` — add `yoda_payment` to `PurchaseData`
- [x] `projects/swamp-runner/src/sdk.ts` — add YODA branch to `requestPurchase`
- [x] `projects/swamp-runner/src/ui/ResultScreen.ts` — add second purchase button + handler
- [ ] Grant: create burn-treasury TON wallet, save seed phrase, set `ARCADE_YODA_BURN_TREASURY` Fly secret
