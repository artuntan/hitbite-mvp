import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { SupportedChainId } from "@/lib/chains";
import { SIMULATED_ATTESTOR_NOTE } from "@/lib/copy";
import type { DocumentResult } from "@/lib/data";
import { formatDate, formatDateTimeUtc, formatUsdcExact } from "@/lib/format";
import type { AttestationDocument, NavDocument } from "@/lib/schemas";

import { AddressLink } from "./address-link";
import { VerifySignatureButton } from "./verify-signature-button";

/**
 * The attestation, published or not.
 *
 * `attestation.json` is deliberately absent from the repository (PLAN.md D34): signing needs the
 * real attestor key, and a signature from a throwaway key would be a meaningless artefact that
 * looks meaningful. So the absent state is a first-class rendering — it says what is missing, what
 * would produce it, and what it would contain — rather than a hidden section or an empty card.
 *
 * Either way the same label travels with it: the attestor here is simulated, and in production an
 * independent firm signs.
 */

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-3">
      <dt className="text-muted text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="text-ink text-sm break-words">{children}</dd>
      {hint ? <dd className="text-muted text-xs leading-relaxed">{hint}</dd> : null}
    </div>
  );
}

function AttestorLabel() {
  return (
    <Alert tone="warning">
      <AlertTitle>{SIMULATED_ATTESTOR_NOTE}</AlertTitle>
      <AlertDescription>
        The key that signs here belongs to this project, not to a third party. A signature proves
        that the document was not altered after it was signed; it does not make the portfolio real,
        and it is not an audit opinion.
      </AlertDescription>
    </Alert>
  );
}

function Published({
  document,
  nav,
  chainId,
}: {
  document: AttestationDocument;
  nav: NavDocument;
  chainId: SupportedChainId;
}) {
  const { attestation, signature } = document;
  const coversCurrentNav = attestation.nav.usdc_6dec === nav.nav.usdc_6dec;

  return (
    <>
      <AttestorLabel />

      {coversCurrentNav ? null : (
        <Alert tone="warning">
          <AlertTitle>This attestation covers an earlier NAV.</AlertTitle>
          <AlertDescription>
            It attests{" "}
            <span className="num">{formatUsdcExact(BigInt(attestation.nav.usdc_6dec))}</span> USDC
            per token as of {formatDate(attestation.as_of)}, while the NAV published above is{" "}
            <span className="num">{formatUsdcExact(BigInt(nav.nav.usdc_6dec))}</span> USDC as of{" "}
            {formatDate(nav.as_of)}. A valid signature over an older document says nothing about
            today&rsquo;s figures.
          </AlertDescription>
        </Alert>
      )}

      <dl className="divide-border divide-y">
        <Field label="Attested NAV per token">
          <span className="num">{formatUsdcExact(BigInt(attestation.nav.usdc_6dec))} USDC</span>
        </Field>
        <Field label="As of" hint={`Signed ${formatDateTimeUtc(attestation.generated_at)}.`}>
          <time dateTime={attestation.as_of}>{formatDate(attestation.as_of)}</time>
        </Field>
        <Field
          label="Positions attested"
          hint="Each holding is attested with its face, prices, accrued interest and market value."
        >
          <span className="num">{attestation.positions_count}</span>
        </Field>
        <Field label="Scheme">
          <span className="addr">{signature.scheme}</span>
        </Field>
        <Field
          label="Attestor address"
          hint="The address the signature must recover to. Simulated; see the note above."
        >
          <AddressLink value={signature.attestor_address} chainId={chainId} />
        </Field>
        <Field label="Attestor public key" hint="SEC1 uncompressed.">
          <span className="addr text-xs">{signature.attestor_public_key}</span>
        </Field>
        <Field label="Signature">
          <span className="addr text-xs">{signature.signature}</span>
        </Field>
        <Field
          label="SHA-256 of the signed message"
          hint="Recomputed by the verify button below, over the exact bytes shown."
        >
          <span className="addr text-xs">{signature.message_sha256}</span>
        </Field>
        <Field label="How to verify elsewhere">
          <span className="text-muted text-sm">{signature.verify_with}</span>
        </Field>
      </dl>

      <Separator />

      <VerifySignatureButton
        message={signature.message}
        signature={signature.signature}
        attestorAddress={signature.attestor_address}
        attestorPublicKey={signature.attestor_public_key}
        messageSha256={signature.message_sha256}
      />

      <details className="border-border bg-surface-sunken rounded-lg border">
        <summary className="text-ink cursor-pointer px-4 py-3 text-sm font-medium">
          The exact signed message ({signature.message.length} characters of canonical JSON)
        </summary>
        <pre className="addr text-muted max-h-96 overflow-auto px-4 pb-4 text-xs leading-relaxed whitespace-pre-wrap">
          {signature.message}
        </pre>
      </details>

      <p className="text-muted max-w-3xl text-xs leading-relaxed">
        The signature is over that string exactly as shown — sorted keys, no spaces, UTF-8. Verify
        against it rather than re-serialising the document: the payload contains{" "}
        <span className="addr">Türkiye</span> and an em dash, so a re-serialisation that normalises
        either would hash to something else and fail for the wrong reason.
      </p>
    </>
  );
}

function Absent({
  reason,
  expectedPath,
  howToPublish,
}: {
  reason: string;
  expectedPath: string;
  howToPublish: string;
}) {
  return (
    <>
      <Alert tone="warning">
        <AlertTitle>No attestation is published.</AlertTitle>
        <AlertDescription>{reason}</AlertDescription>
      </Alert>

      <dl className="divide-border divide-y">
        <Field label="Expected at" hint="Repository-relative; not committed, by design.">
          <span className="addr">{expectedPath}</span>
        </Field>
        <Field
          label="Produced by"
          hint="Run by a maintainer who holds the attestor key; the key is never in this repository."
        >
          <span className="addr">{howToPublish}</span>
        </Field>
      </dl>

      <div className="flex flex-col gap-2">
        <h3 className="text-ink text-sm font-semibold">What will appear here</h3>
        <ul className="text-muted flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
          <li>
            The attested payload: NAV per token, the cash and fee balances, every holding with its
            prices and market value, the supply-backed ratio, and the chain the figures were read
            from.
          </li>
          <li>
            The exact canonical JSON string that was signed, published verbatim so that verifying it
            never depends on reproducing our serialisation.
          </li>
          <li>
            An EIP-191 <span className="addr">personal_sign</span> secp256k1 signature, the attestor
            address, the SEC1 uncompressed public key and the SHA-256 of the signed message.
          </li>
          <li>
            A <span className="text-ink font-medium">Verify signature in browser</span> button that
            recovers the signer with viem, in this tab, and shows you the address it recovered.
          </li>
        </ul>
      </div>

      <AttestorLabel />
    </>
  );
}

export function AttestationPanel({
  result,
  nav,
  chainId,
}: {
  result: DocumentResult<AttestationDocument>;
  nav: NavDocument;
  chainId: SupportedChainId;
}) {
  const published = result.status === "published";

  return (
    <section
      aria-labelledby="attestation-heading"
      data-testid="attestation"
      data-state={published ? "published" : "absent"}
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle as="h2" id="attestation-heading" className="text-lg">
              Attestation
            </CardTitle>
            {published ? (
              <StatusBadge tone="accent">Published</StatusBadge>
            ) : (
              <StatusBadge tone="warning">Not published</StatusBadge>
            )}
          </div>
          <CardDescription>
            A signed snapshot of the book: the figures above, serialised canonically and signed with
            a secp256k1 key, so that anyone can check the document they are reading is the document
            that was signed.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {result.status === "published" ? (
            <Published document={result.document} nav={nav} chainId={chainId} />
          ) : (
            <Absent
              reason={result.reason}
              expectedPath={result.expectedPath}
              howToPublish={result.howToPublish}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
