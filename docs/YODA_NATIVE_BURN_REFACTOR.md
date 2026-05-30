# $YODA Native Burn Refactor

**Decision (Grant 2026-05-29):** Replace burn-treasury wallet with TEP-74
native jetton burn op. Real on-chain supply decrease, no custodial wallet.

## What changes vs the original spec

| Layer | Was | Now |
|---|---|---|
| Backend purchase row | needed `ARCADE_YODA_BURN_TREASURY` env var | drop it entirely — no destination |
| Backend confirmation worker | poll burn-treasury jetton inbox for inbound transfers | poll jetton master events for `JettonBurn`, match by `custom_payload` purchase ID |
| Shell jetton message | op `0x0f8a7ea5` (transfer) to payer's jetton wallet, payload = forward text comment | op `0x595f07bc` (burn) to payer's jetton wallet, payload = purchase ID in custom_payload cell |
| Game UI tagline | "burned forever 🔥" (was a lie) | "burned forever 🔥" (now actually true) |

## TEP-74 burn op body

Per the jetton standard:

```
burn#595f07bc query_id:uint64 amount:(VarUInteger 16)
              response_destination:MsgAddress
              custom_payload:(Maybe ^Cell) = InternalMsgBody;
```

Construction (`@ton/core`):

```ts
const BURN_OP = 0x595f07bc;
const queryId = BigInt(Date.now());
const amount = BigInt(yp.amount_nano);                       // 50_000_000_000
const responseDestination = Address.parse(payerAddress);     // refund excess gas
const customPayload = beginCell()
  .storeUint(0, 32)                                          // text-comment subop
  .storeStringTail(yp.comment)                               // "sg_<purchase-suffix>"
  .endCell();

const body = beginCell()
  .storeUint(BURN_OP, 32)
  .storeUint(queryId, 64)
  .storeCoins(amount)
  .storeAddress(responseDestination)
  .storeBit(true)                                            // custom_payload present
  .storeRef(customPayload)
  .endCell();

const payloadB64 = body.toBoc().toString('base64');
```

Send target: the **payer's jetton wallet address** (same derivation as
transfer path — `GET /v2/accounts/{owner}/jettons/{master}` →
`wallet_address.address`).

Attached TON for gas: `'50000000'` (0.05 TON, same as transfer; jetton
wallet refunds excess to `response_destination`).

## Backend confirmation worker

Rename `yoda_payment_confirm.py` → still works, just changes its data
source. Replace the jetton-history endpoint with master events:

```
GET https://tonapi.io/v2/accounts/{jetton_master}/events?limit=50
```

Filter events where `actions[].type == 'JettonBurn'` and:
- `actions[i].JettonBurn.jetton.address` == jetton_master
- decode `actions[i].JettonBurn.custom_payload` (if exposed) OR parse the
  raw `in_msg.decoded_body.custom_payload` of the source tx

If tonapi.io doesn't surface custom_payload cleanly on burn events
(common — burn op is less-decoded than transfer), fall back to:
1. For each pending YODA purchase, look up payer_address (from
   `arcade_mark_purchase_paid_pending`)
2. Poll the **payer's jetton wallet** outbound history for burn ops
3. Match by amount + time window (60s) since the payer + amount + window
   is unique enough given our per-purchase rate

Preferred: try custom_payload decoding first; fall back to payer-address
matching if tonapi doesn't expose it.

## Environment

- DELETE: any reference to `ARCADE_YODA_BURN_TREASURY` in code, tests,
  docs, env templates. Grant will not create that wallet.
- KEEP: `YODA_JETTON_MASTER` (falls back to `BABYYODA_TON_CONTRACT`).

## File-edit checklist

### Backend (`projects/babyyoda-bot`)
- [ ] `app/api/arcade.py` — remove `ARCADE_YODA_BURN_TREASURY` check; the
      YODA branch now needs only `jetton_master`. Update `yoda_payment`
      response block: remove `to_owner`, add `op: 'burn'` marker or just
      drop the destination field. Suggested final shape:
      ```python
      yoda_payment_block = {
          "kind": "burn",                       # NEW — distinguishes from future transfer ops
          "jetton_master": jetton_master,
          "amount_nano": str(price),
          "comment": comment_payload,
          "valid_until": valid_until,
          "attached_ton": "50000000",           # 0.05 TON for gas
      }
      ```
- [ ] `app/jobs/yoda_payment_confirm.py` — rewrite scan loop to use master
      event endpoint OR payer-address-matched outbound burn detection.
      Preserve idempotency guarantees of original worker.
- [ ] `tests/test_arcade_v0.py` — update 2 new YODA tests for the new
      `yoda_payment` block shape; remove any treasury setup.

### Shell (`projects/babyyoda-bot/mini-app`)
- [ ] `lib/walletRpc.ts` — `requestYodaPayment` case:
      - Drop jetton transfer body builder
      - Add jetton burn body builder (TEP-74, op `0x595f07bc`, schema above)
      - Send target is still the payer's jetton wallet (unchanged derivation)
      - Remove all references to `to_owner` from the `YodaPaymentBlock` consumed

### Game (`projects/swamp-runner`)
- [ ] `src/sdk.ts` — `YodaPaymentBlock` type:
      - Remove `to_owner` field
      - Add `kind: 'burn'`
      - Rename `forward_ton_amount` → `attached_ton`
- [ ] `src/ui/ResultScreen.ts` — no code changes; the tagline already
      says "burned forever 🔥" and now it's literally true. (Optional:
      add a tiny info link / tooltip explaining "supply decreases on-chain".)
- [ ] `docs/YODA_EXTRA_PLAY_SPEC.md` — update to reflect native burn,
      note this refactor in a changelog block at the top.

## Acceptance criteria

1. Backend YODA purchase route works with NO `ARCADE_YODA_BURN_TREASURY` env
   var set (only `YODA_JETTON_MASTER` / `BABYYODA_TON_CONTRACT` required).
2. Shell `requestYodaPayment` constructs a TEP-74 burn message.
3. Tonkeeper accepts the message and signs.
4. On-chain: total_supply of YODA jetton decreases by 50.
5. Confirmation worker detects the burn within ~15s and flips
   purchase row to `paid`.
6. Game grants extra play.
7. Existing TON purchase flow untouched (10/10 TON tests still pass).

## Out of scope

- Verifying on testnet first (mainnet only — burn is cheap and visible).
- Burn-event signed proof (we trust tonapi's view of the master's events).
- Refactoring the original treasury-based code paths in git history.
- Removing `@ton/core` dep (still needed for burn body construction).
