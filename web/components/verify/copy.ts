/**
 * Fixed copy for `/verify`.
 *
 * Verification is the one screen where a wrong sentence is not a style problem. Somebody arriving
 * here reasonably expects the word "verify" to mean an identity check, and it does not: no document
 * is asked for, none is read, none is kept, and the approval is a timer. Every claim below was
 * written by reading `lib/server/store.ts`, `lib/server/registrar.ts` and `COMPLIANCE_RULES.md`
 * rather than by describing what a KYC form usually does, so the strings live in one file and can
 * be checked against those sources line by line.
 *
 * Nothing here is imported from `lib/copy.ts`, which holds the fixed disclosures from
 * BUILD_PROMPT.md section 15. Those are rendered by the shell on every page and are not repeated.
 */

import type { VerificationStatus } from "@/lib/server/verification";

/** The five states BUILD_PROMPT.md 7.2 names, plus the two the API can also answer with. */
export type VerifyScreen =
  "not-connected" | "loading" | "form" | "pending" | "approved" | "rejected" | "blocked";

/** Badge/alert tones, matching `components/ui/badge.tsx`. */
export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export const VERIFY_INTRO =
  "Verification puts your wallet address on the IdentityRegistry whitelist, which is the only thing that lets it receive hbTRS. It is a registry entry, not an identity check." as const;

/**
 * The first thing on the page, above the form. BUILD_PROMPT.md section 2 forbids a real KYC vendor
 * in this MVP, and `verification_requests` has no column for a name, a document or a date of birth
 * — so the honest framing is that there is nothing here to hand personal data to.
 */
export const NOT_KYC = {
  title: "This is not KYC, and nothing here checks who you are",
  paragraphs: [
    "No identity document is requested, read, uploaded or stored. There is no vendor behind this form, no reviewer, no sanctions screen and no register of people. What you send is a wallet address, one ISO country code, and two declarations, and that is the whole of it.",
    "Do not type real personal data into this app. There is nowhere for it to go: the API drops every field it does not recognise, and the database has no column for one.",
  ],
  /** Rendered beside the form, where the name field would otherwise be. */
  noNameField:
    "BUILD_PROMPT.md 7.2 lists a name field. There is deliberately none: a testnet demonstration that collected names would be a liability with no benefit, so the server stores none, the table has no column for one, and a name posted to /api/verify is ignored rather than saved.",
} as const;

/**
 * PLAN.md D8. The delay is `AUTO_APPROVE_DELAY_MS`, default 10 000, and the approval is a server
 * key calling `addVerified`. Calling that a "review" would be a lie with a straight face.
 */
export const SIMULATED_REGISTRAR = {
  badge: "Simulated registrar",
  short:
    "Approval on this testnet is automatic after a short delay. It simulates a licensed partner running a KYC vendor; it does not perform one.",
  long: "In production the licensed fund manager's KYC vendor decides, and writes the result to the same registry through the same registrar role. Here, a server key signs addVerified once a timer elapses. The rule set it is allowed to write under is identical — that part is real and is enforced on chain.",
} as const;

/** PLAN.md D21, COMPLIANCE_RULES.md section 1. */
export const RETAIL = {
  title: "Retail investors cannot be verified in phase one",
  body: "IdentityRegistry.addVerified reverts RetailNotAllowed for investor type 2, so a retail request cannot be fulfilled on chain and is not submitted. The field exists in storage so a later phase can enable it without a migration. This is not a decision the interface is making on its own: the contract refuses it.",
} as const;

/** COMPLIANCE_RULES.md section 1, said once, plainly, wherever a rule is shown. */
export const ON_CHAIN_IS_THE_RULE =
  "The contract is what enforces this, not this form. IdentityRegistry.addVerified reverts CountryBlocked, RetailNotAllowed or NotRegistrar whatever the interface believes, and anyone can call the API or the contract directly without going through this page." as const;

export const BLOCKLIST_INTRO =
  "The registry holds a country blocklist its admin can change at any time. The full ISO 3166-1 list is offered below; the codes on the blocklist are shown here with the reason and cannot be picked." as const;

/**
 * What a submitted request actually leaves behind. Read off the `verification_requests` schema in
 * `lib/server/store.ts` and off `addVerified` in `IdentityRegistry`. Nothing here is encrypted,
 * nothing expires, and no path in this app deletes a row — saying otherwise would be inventing a
 * property the code does not have.
 */
export const WHAT_IS_STORED = {
  title: "What a request leaves behind",
  server: [
    "A row in the verification_requests table keyed by your address: the checksummed address, the ISO country code you pick, the investor type, the two declarations as booleans, the status and its reason, the approval transaction hash, how many times the worker has tried, and four timestamps.",
    "It is stored as plain rows in SQLite or libSQL. It is not encrypted, and no part of this app deletes it. Submitting again overwrites the row, unless it has already been approved, in which case it is left alone.",
  ],
  chain: [
    "Once approved, your address, the country code and the investor type are written to IdentityRegistry on a public test network by the registrar. That record is readable by anyone, permanently, and this app cannot take it back. Only an admin calling removeVerified can.",
  ],
} as const;

export const CONSENT_LABEL =
  "I understand this is a testnet demonstration, that nothing here is an offer of securities, and I consent to this request being stored and to my address and country code being written to a public test network." as const;

export const ATTESTATION_LABEL =
  "I declare that I am a professional investor. Nobody checks this declaration; the registry records the claim." as const;

/** How each status is announced. Colour never carries the meaning on its own — the label does. */
export const STATUS_PRESENTATION: Record<VerificationStatus, { label: string; tone: Tone }> = {
  pending: { label: "Awaiting the registrar", tone: "accent" },
  approved: { label: "Verified", tone: "success" },
  rejected: { label: "Refused", tone: "warning" },
  blocked: { label: "Country blocked", tone: "danger" },
};

/** The rule names `POST /api/verify` returns, in words. */
export const RULE_TITLES: Record<string, string> = {
  country_blocked: "That country is on the registry blocklist",
  retail: RETAIL.title,
  no_attestation: "The professional-investor declaration was not given",
  no_consent: "Consent was not given",
};
