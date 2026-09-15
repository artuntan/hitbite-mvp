/**
 * The parts of `/verify` that do not need a wallet, a fetch or a state machine.
 *
 * Server components on purpose: they are the page's honest half, they are in the HTML before any
 * JavaScript runs, and they cost this route nothing in bundle size. Nothing here imports the wallet
 * layer or `lib/server/`.
 */

import { Ban, FileX2, KeyRound, Terminal } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NOT_KYC, SIMULATED_REGISTRAR, WHAT_IS_STORED } from "@/components/verify/copy";

/**
 * Above the form, unmissable, before anything can be typed. BUILD_PROMPT.md section 2 rules out a
 * real KYC vendor, so the word "verify" on this page has to be explained rather than assumed.
 */
export function NotKycNotice() {
  return (
    <Alert tone="warning" hideIcon className="flex-col items-start gap-3">
      <div className="flex items-start gap-3">
        <FileX2 aria-hidden="true" className="text-warning mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <AlertTitle>{NOT_KYC.title}</AlertTitle>
          <AlertDescription>
            {NOT_KYC.paragraphs.map((paragraph) => (
              <p key={paragraph} className="[&:not(:first-child)]:mt-2">
                {paragraph}
              </p>
            ))}
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}

const STEPS = [
  {
    icon: Terminal,
    title: "You submit the form",
    body: "POST /api/verify stores one row: your address, the country code, the two declarations, and the status. You sign nothing and spend no gas. A country the registry blocks, a retail investor type, or a missing declaration is refused here and recorded as refused, with the reason.",
  },
  {
    icon: KeyRound,
    title: "A timer elapses, then the worker runs",
    body: "The page calls POST /api/verify/process once the delay is up; a cron or an operator can call it too. The worker re-checks the country against the registry and the investor type immediately before signing, because minutes may have passed and an admin may have changed the blocklist in between.",
  },
  {
    icon: Ban,
    title: "The registrar writes to the registry",
    body: "A server key holding REGISTRAR_ROLE sends addVerified(address, country, 1). That transaction is the whole of the approval, and IdentityRegistry refuses it — CountryBlocked, RetailNotAllowed, NotRegistrar — if any rule does not hold, whatever this app believes.",
  },
] as const;

export function HowVerificationWorks({ origin = "http://localhost:3000" }: { origin?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">What happens when you submit</CardTitle>
        <CardDescription>{SIMULATED_REGISTRAR.long}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="border-border bg-surface-sunken flex flex-col gap-2 rounded-lg border p-4"
            >
              <div className="flex items-center gap-2">
                <step.icon aria-hidden="true" className="text-accent-ink size-4" />
                <span className="text-muted num text-xs">Step {index + 1}</span>
              </div>
              <p className="text-ink text-sm font-medium">{step.title}</p>
              <p className="text-muted text-sm leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2">
          <p className="text-ink text-sm font-medium">The same flow without this page</p>
          <p className="text-muted text-sm leading-relaxed">
            Nothing here is privileged. The four calls the form makes are the four calls anyone can
            make, and they answer the same JSON envelope as the public endpoints. The origin below
            is the local dev server; swap it for a deployment host as needed.
          </p>
          <pre className="border-border bg-surface-sunken text-ink overflow-x-auto rounded-lg border p-4 text-xs leading-relaxed">
            <code>{`curl -s ${origin}/api/verify | jq '.data.blocked'

curl -X POST ${origin}/api/verify \\
  -H 'content-type: application/json' \\
  -d '{"address":"0x…","country":276,"professional_attestation":true,"consent":true}'

curl -X POST ${origin}/api/verify/process

curl -s '${origin}/api/verify/status?address=0x…' | jq '.data | {status, source}'`}</code>
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}

export function WhatIsStored() {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{WHAT_IS_STORED.title}</CardTitle>
        <CardDescription>
          Written from the table definition in lib/server/store.ts and from addVerified, not from
          what a privacy notice usually says.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-ink text-sm font-medium">On the server</h3>
          {WHAT_IS_STORED.server.map((paragraph) => (
            <p key={paragraph} className="text-muted text-sm leading-relaxed">
              {paragraph}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-ink text-sm font-medium">On the chain</h3>
          {WHAT_IS_STORED.chain.map((paragraph) => (
            <p key={paragraph} className="text-muted text-sm leading-relaxed">
              {paragraph}
            </p>
          ))}
          <p className="text-muted text-sm leading-relaxed">
            Nothing in this app encrypts either record, and nothing in it deletes one. Saying
            otherwise would be describing a feature that does not exist.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
