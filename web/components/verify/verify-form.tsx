"use client";

/**
 * The verification request form.
 *
 * Four answers leave this page: the connected address, one ISO 3166-1 numeric code, and two
 * declarations. There is no name field and no file input — see `NOT_KYC.noNameField`.
 *
 * Every rule the form applies is applied again by `/api/verify` and, where it matters, a third time
 * by `IdentityRegistry` (COMPLIANCE_RULES.md section 1). So the checks here are explanations, not
 * enforcement, and the copy says so rather than implying that a disabled button is a control.
 */

import * as React from "react";
import { Send } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiFailure, SubmitBody } from "@/components/verify/api";
import {
  ATTESTATION_LABEL,
  CONSENT_LABEL,
  NOT_KYC,
  ON_CHAIN_IS_THE_RULE,
  RETAIL,
} from "@/components/verify/copy";
import { BlocklistNote, CountrySelect } from "@/components/verify/country-select";
import { CheckboxField, RadioCards } from "@/components/verify/fields";
import type { BlocklistState } from "@/components/verify/use-blocklist";
import { getCountryByAlpha2, getCountryByNumeric, isKnownCountryCode } from "@/lib/countries";
import { formatAddress } from "@/lib/format";

type InvestorChoice = "professional" | "retail";

const INVESTOR_OPTIONS = [
  {
    value: "professional" as const,
    label: "Professional investor",
    description:
      "The only type IdentityRegistry accepts today. Recorded as investorType 1 on the chain.",
  },
  {
    value: "retail" as const,
    label: "Retail investor",
    description: "Recorded as investorType 2, which addVerified refuses in phase one.",
  },
];

export interface VerifyFormProps {
  /** The connected wallet, or `undefined`. The form is readable and fillable either way. */
  address?: string;
  blocklist: BlocklistState;
  isSubmitting: boolean;
  submitFailure: ApiFailure | null;
  onSubmit: (body: SubmitBody) => void;
  /** Rendered above the fields, e.g. the refusal panel from a previous attempt. */
  children?: React.ReactNode;
}

/**
 * `?country=840` or `?country=US` preselects the field. A deep link straight to a country is what
 * the demo script and the docs want, and it is also the only way to land on the page with a blocked
 * country already chosen — which is exactly the state the refusal message exists for.
 */
function countryFromQuery(search: string): number | null {
  const raw = new URLSearchParams(search).get("country");
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{1,3}$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return isKnownCountryCode(numeric) ? numeric : null;
  }
  return getCountryByAlpha2(trimmed)?.numeric ?? null;
}

export function VerifyForm({
  address,
  blocklist,
  isSubmitting,
  submitFailure,
  onSubmit,
  children,
}: VerifyFormProps) {
  const [country, setCountry] = React.useState<number | null>(null);
  const [investor, setInvestor] = React.useState<InvestorChoice>("professional");
  const [attestation, setAttestation] = React.useState(false);
  const [consent, setConsent] = React.useState(false);

  // Read on the client only: the page is prerendered, and `useSearchParams` would opt the whole
  // route out of that for one optional convenience.
  React.useEffect(() => {
    const preset = countryFromQuery(window.location.search);
    if (preset !== null) setCountry(preset);
  }, []);

  const selected = country === null ? null : getCountryByNumeric(country);
  const blockedReason = country === null ? null : (blocklist.blocked.get(country) ?? null);
  const isRetail = investor === "retail";

  /**
   * What is standing between this form and a request, most fundamental first.
   *
   * A blocked country and a retail investor type come before "connect a wallet" on purpose:
   * connecting one would not help, and telling somebody to fetch their wallet before telling them
   * the answer is no would be the wrong order to learn it in.
   */
  const blocker: string | null =
    [
      blockedReason !== null
        ? `${selected?.name ?? `Country ${country}`} is on the registry blocklist, so this request cannot be made.`
        : null,
      isRetail ? `${RETAIL.title}.` : null,
      !address
        ? "Connect a wallet to submit this request. The address is the only thing being verified."
        : null,
      country === null ? "Choose the country of residence." : null,
      !attestation ? "Tick the professional-investor declaration." : null,
      !consent ? "Tick the consent box." : null,
    ].find((problem) => problem !== null) ?? null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Defence in depth: the button is disabled, and pressing Enter in a field still cannot send a
    // request the page has already said no to.
    if (blocker !== null || !address || country === null) return;
    onSubmit({
      address,
      country,
      professional_attestation: attestation,
      consent,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Request verification</CardTitle>
        <CardDescription>
          Four things are sent: your address, one country code, and the two declarations below.
          Nothing else is collected, and nothing else is stored.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {children}

        <p className="text-muted text-sm leading-relaxed">{NOT_KYC.noNameField}</p>

        <form id="verify-form" onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
          <div className="border-border bg-surface-sunken flex flex-col gap-1 rounded-lg border p-4">
            <p className="text-muted text-xs tracking-wide uppercase">Address to verify</p>
            {address ? (
              <p className="addr text-ink text-sm" title={address}>
                {address}
              </p>
            ) : (
              <p className="text-muted text-sm">No wallet connected.</p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <CountrySelect
              id="verify-country"
              value={country}
              onValueChange={setCountry}
              blocked={blocklist.blocked}
              describedBy={blockedReason !== null ? "verify-country-blocked" : undefined}
            />

            {blockedReason !== null ? (
              <Alert tone="danger" id="verify-country-blocked" data-testid="country-blocked">
                <AlertTitle>{selected?.name ?? `Country ${country}`} cannot be verified</AlertTitle>
                <AlertDescription>
                  <p>{blockedReason}</p>
                  <p className="mt-2">{ON_CHAIN_IS_THE_RULE}</p>
                </AlertDescription>
              </Alert>
            ) : null}

            <BlocklistNote state={blocklist} />
          </div>

          <RadioCards
            name="investor-type"
            legend="Investor type"
            hint="The registry stores this number alongside the country. Nobody checks the claim."
            value={investor}
            options={INVESTOR_OPTIONS}
            onValueChange={setInvestor}
          />

          {isRetail ? (
            <Alert tone="warning" data-testid="retail-refusal">
              <AlertTitle>{RETAIL.title}</AlertTitle>
              <AlertDescription>
                <p>{RETAIL.body}</p>
                <p className="mt-2">
                  Posting investor_type 2 to /api/verify gets the same answer in writing: the
                  request is stored as refused, with the rule that refused it, and nothing is sent
                  on chain.
                </p>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-4">
            <CheckboxField
              id="verify-attestation"
              checked={attestation}
              onCheckedChange={setAttestation}
              label={ATTESTATION_LABEL}
              description="Sent as professional_attestation. The server refuses the request without it; the chain never sees the flag."
            />
            <CheckboxField
              id="verify-consent"
              checked={consent}
              onCheckedChange={setConsent}
              label={CONSENT_LABEL}
              description="Sent as consent. Without it the request is stored as refused and nothing is sent on chain."
            />
          </div>

          {submitFailure ? (
            <Alert tone="danger">
              <AlertTitle>The request was not recorded</AlertTitle>
              <AlertDescription>
                <p>{submitFailure.message}</p>
                {submitFailure.hint ? <p className="mt-1">{submitFailure.hint}</p> : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <div>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={blocker !== null || isSubmitting}
                aria-describedby="verify-submit-reason"
              >
                <Send aria-hidden="true" />
                {isSubmitting ? "Sending the request…" : "Submit verification request"}
              </Button>
            </div>
            <p id="verify-submit-reason" role="status" className="text-muted text-sm">
              {blocker ??
                (address
                  ? `Sends ${selected?.name ?? "the selected country"} and ${formatAddress(address)} to /api/verify. Nothing is signed and no gas is spent.`
                  : "")}
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
