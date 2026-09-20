# Generated live testnet status

Generated only by `pnpm e2e`. Started 2026-09-20T10:04:16.732Z; finished 2026-09-20T10:05:42.633Z.

App: [hitbite-testnet-v2.vercel.app](https://hitbite-testnet-v2.vercel.app) · Chain: 5042002 · [Source commit](https://github.com/artuntan/hitbite-mvp/commit/570eabd2891c01920860cfc5874a766276feaabb) · [CI](https://github.com/artuntan/hitbite-mvp/actions/runs/35503845488)

All automated Core checks passed against the live Arc deployment.

| Feature | Result | Evidence |
|---|---|---|
| Contracts | ✅ Passed | 3 checks |
| Verify | ✅ Passed | 3 checks |
| Subscribe | ✅ Passed | 4 checks |
| Hold / coupons | ✅ Passed | 3 checks |
| Redeem | ✅ Passed | 2 checks |
| Admin | ✅ Passed | 3 checks |
| NAV engine | ✅ Passed | 1 checks |
| Connect | ✅ Passed | 1 checks |
| Overview | ✅ Passed | 1 checks |
| Transparency | ✅ Passed | 1 checks |
| Founder walkthrough | ✅ Passed | 1 checks |
| CI | ✅ Passed | 1 checks |

## Live run

Wallet A: `0xdf11828012f4aFd88FaAde610Ad267a53A565Fb0`  
Wallet B: `0x6aE14F0ad1333a7Ec497d69904611CBeEB03f7CD`  
Issuer: `0x3360a13444E3A7aCA76b42D55d03D2855f08Bb3d`

| Check | Result | Receipt / observation | Events |
|---|---|---|---|
| NAV, trust anchor and four live routes | ✅ | RPC chain allowlist; deployed contract code; 6-decimal settlement asset; fresh matching NAV; attestation trust anchor; US/TR blocklist; all four product routes; NAV 1000000 micro-USDC. | — |
| Browser flow and client-side verification evidence | ✅ | Automated browser test at 2026-09-20T10:00:41.995Z; wallet 0x17C09Bc328A2F9C5ECa00f5a6E4e3721BFe1a868. This is not founder acceptance. | — |
| Overview renders the same NAV as the chain and JSON | ✅ | Confirmed | — |
| Transparency verifies its signature client-side | ✅ | Confirmed | — |
| Founder confirms the complete fresh-wallet flow | ✅ | Founder explicitly confirmed verification, subscription, coupon claim and redemption at 2026-09-20T10:00:23.315834+00:00. | — |
| CI checks for the source commit | ✅ | https://github.com/artuntan/hitbite-mvp/actions/runs/35503845488 | — |
| Fresh independent wallets and funded testnet | ✅ | Fresh wallets 0xdf11828012f4aFd88FaAde610Ad267a53A565Fb0 and 0x6aE14F0ad1333a7Ec497d69904611CBeEB03f7CD; chain 5042002. | — |
| US and Türkiye are blocked in API and contract | ✅ | Confirmed | — |
| Wallet A: signed simulated verification | ✅ | [0x95798fa455b0814fc62bb17fc0f1f57511cbaf021065574d03f80f2b65b1f8f5](https://explorer.testnet.arc.io/tx/0x95798fa455b0814fc62bb17fc0f1f57511cbaf021065574d03f80f2b65b1f8f5) · block 63069487 | Verified |
| Wallet A: approve exact USDC subscription | ✅ | [0x9ae029a00a900634322a98488258cbb8a57c6d6d74d1bb5ab6faf8428f614141](https://explorer.testnet.arc.io/tx/0x9ae029a00a900634322a98488258cbb8a57c6d6d74d1bb5ab6faf8428f614141) · block 63069498 | Approval |
| Wallet A: subscribe with 6-decimal USDC | ✅ | [0xb90956fe6272f5968cc9cd7faf259803489c5fc18536771419997b38294e6c0d](https://explorer.testnet.arc.io/tx/0xb90956fe6272f5968cc9cd7faf259803489c5fc18536771419997b38294e6c0d) · block 63069509 | Transfer, Subscribed |
| Wallet B: signed simulated verification | ✅ | [0x7b5a3dcfbd3e5fba5496b21b1cf1b1b7677799aa6cecce2d5d5c4fd130479115](https://explorer.testnet.arc.io/tx/0x7b5a3dcfbd3e5fba5496b21b1cf1b1b7677799aa6cecce2d5d5c4fd130479115) · block 63069541 | Verified |
| Wallet B: approve exact USDC subscription | ✅ | [0x4c61539301427a954866ef5b3d2d0c2da6e3b06b5b46794db74c9062e995ba44](https://explorer.testnet.arc.io/tx/0x4c61539301427a954866ef5b3d2d0c2da6e3b06b5b46794db74c9062e995ba44) · block 63069553 | Approval |
| Wallet B: subscribe with 6-decimal USDC | ✅ | [0x81e0affd4904b05d1632e1c842c2de95f1f1c0fa2992f4086d70d9f265dda794](https://explorer.testnet.arc.io/tx/0x81e0affd4904b05d1632e1c842c2de95f1f1c0fa2992f4086d70d9f265dda794) · block 63069564 | Transfer, Subscribed |
| Unverified wallet cannot receive hbTRS | ✅ | Confirmed | — |
| Issuer approves coupon funding | ✅ | [0xbe449d66a9ec44207e1d0104996baea9401746d3d16a713abc23f5008f448c89](https://explorer.testnet.arc.io/tx/0xbe449d66a9ec44207e1d0104996baea9401746d3d16a713abc23f5008f448c89) · block 63069574 | Approval |
| Issuer distributes a funded coupon | ✅ | [0x98ca3ed4dafe26d5a9d22274eb361498fcc9286c1ec7404bc8fe39ff552d520b](https://explorer.testnet.arc.io/tx/0x98ca3ed4dafe26d5a9d22274eb361498fcc9286c1ec7404bc8fe39ff552d520b) · block 63069577 | Transfer, CouponDistributed |
| Wallet A: claim accrued coupon | ✅ | [0xdeab20f5c46b762014a989dc3001b2c744e944377e4fb8783b45c90746ccceaf](https://explorer.testnet.arc.io/tx/0xdeab20f5c46b762014a989dc3001b2c744e944377e4fb8783b45c90746ccceaf) · block 63069587 | Transfer, CouponClaimed |
| Wallet A: redeem full token balance | ✅ | [0x2a9a3ae8fd3444de8e3e5a31411c981f6e4af7679b2247ab0732420b9b88e119](https://explorer.testnet.arc.io/tx/0x2a9a3ae8fd3444de8e3e5a31411c981f6e4af7679b2247ab0732420b9b88e119) · block 63069590 | Transfer, Redeemed |
| Wallet B: claim accrued coupon | ✅ | [0xa1ad92e9ca1174792cffb4cb76bb28773ab55c2f8b7b1aadb720b4289df9d677](https://explorer.testnet.arc.io/tx/0xa1ad92e9ca1174792cffb4cb76bb28773ab55c2f8b7b1aadb720b4289df9d677) · block 63069593 | Transfer, CouponClaimed |
| Wallet B: redeem full token balance | ✅ | [0x3cab8ebbe008184192a56a2900683219547f0451dfee93f14fad65f9cf6ece48](https://explorer.testnet.arc.io/tx/0x3cab8ebbe008184192a56a2900683219547f0451dfee93f14fad65f9cf6ece48) · block 63069604 | Transfer, Redeemed |
| Issuer pauses token | ✅ | [0x55d05aa196b3f2c5d8ccb624b9a6504ac1fb120ec766b47ad3c06203cedd8a7f](https://explorer.testnet.arc.io/tx/0x55d05aa196b3f2c5d8ccb624b9a6504ac1fb120ec766b47ad3c06203cedd8a7f) · block 63069607 | Paused |
| Pause blocks subscription | ✅ | Confirmed | — |
| Issuer restores unpaused token | ✅ | [0x432a2380deb076db1edc7a48b1e98292c1586d1e82fae19f198a2e3801eb739e](https://explorer.testnet.arc.io/tx/0x432a2380deb076db1edc7a48b1e98292c1586d1e82fae19f198a2e3801eb739e) · block 63069617 | Unpaused |

## Acceptance and limits

- ✅ The founder explicitly confirmed completing the full flow with a fresh wallet. See [acceptance record](deployments/evidence/founder-acceptance.json).
- This run covers the selected Arc deployment. Base Sepolia deployment, monthly coupon automation and WalletConnect QR pairing are not claimed. Injected browser wallets are supported.
- Portfolio and prices are simulated. Quotes carry forward until manually revised; attestation authenticates a historical simulated snapshot, not real custody.
- The simulated registrar uses signed review tickets and on-chain eligibility records; production KYC and distributed abuse prevention require the licensed partner.
- Tests transact with real testnet USDC; transaction fees mean wallet cash differences include gas. Event amounts and token balances are checked separately.
