import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

import { CodeBlock } from "@/components/developers/code-block";
import { ContractReads } from "@/components/developers/contract-reads";
import { EndpointCard, endpointAnchor } from "@/components/developers/endpoint-card";
import { Container } from "@/components/layout/container";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACTIVE_CHAIN, SUPPORTED_CHAIN_IDS } from "@/lib/chains";
import { TESTNET_NOTICE_SHORT, TOKEN } from "@/lib/copy";
import {
  buildOpenApiDocument,
  ENDPOINTS,
  OPENAPI_ROUTE,
  OPENAPI_VERSION,
  PARTNER_GUIDE_PATH,
  PUBLIC_CACHE_CONTROL,
  UNDOCUMENTED_ROUTES,
  UNDOCUMENTED_ROUTE_PREFIXES,
} from "@/lib/openapi";

/**
 * `/developers` — the public API, rendered.
 *
 * A **server component**, and a public one: no `wagmi`, no RainbowKit, nothing from
 * `components/wallet/`. The single client leaf is the copy button beside each code sample
 * (PLAN.md D63), which is what "copyable" has to mean if the page is to be usable with a keyboard.
 *
 * Everything on it is read from `lib/openapi.ts`: the same model that builds the document served
 * at `/api/openapi.json`, whose schemas are generated from the zod schemas in `lib/schemas.ts`
 * that every route validates its response against on the way out. There is one description of
 * this API and three renderings of it — the JSON, this page, and the types a partner generates —
 * so none of them can quietly disagree with the others.
 *
 * The page is rendered per request because the `curl` samples carry the origin that served it.
 * A sample a reader has to edit before it runs is a sample most readers get wrong once.
 *
 * `PARTNER_INTEGRATION.md` is referenced, not reproduced. It carries the narrative — what the
 * transfer restrictions do to a custody wallet, how to size a haircut — and duplicating it here
 * would create a second copy to keep in step with the first.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Developers",
  description: `The public JSON API for ${TOKEN.symbol}: NAV, holdings, attestation, stats and decoded contract events, with an OpenAPI 3.1 description at ${OPENAPI_ROUTE}. ${TESTNET_NOTICE_SHORT}`,
};

/**
 * The origin that served this page, so every `curl` on it can be pasted and run.
 *
 * The host header is attacker-controllable in principle, so it is validated against a strict
 * pattern before it reaches the page. It is only ever interpolated into displayed text — there is
 * no redirect, no fetch and no link built from it — and an unrecognisable value degrades to the
 * placeholder rather than rendering whatever was sent.
 */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (!host || !/^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(host)) return "https://<host>";
  const forwardedProto = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol =
    forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : "http";
  return `${protocol}://${host}`;
}

export default async function DevelopersPage() {
  const baseUrl = await requestOrigin();
  const document = buildOpenApiDocument();

  const exampleSuccess = JSON.stringify(
    { ok: true, data: { nav: { per_token_usd: "1.003061", usdc_6dec: 1003061 } } },
    null,
    2,
  );
  const exampleError = JSON.stringify(
    {
      ok: false,
      error: {
        code: "bad_request",
        message: "`limit` must be a whole number between 1 and 200.",
        hint: "Try ?limit=50, or omit it. Use `cursor` to read past 200 events.",
      },
    },
    null,
    2,
  );

  return (
    <Container className="flex flex-col gap-8 py-10 sm:gap-10 sm:py-12">
      <header className="flex max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">OpenAPI {OPENAPI_VERSION}</Badge>
          <Badge tone="accent">Read-only</Badge>
          <Badge tone="warning">Testnet only</Badge>
        </div>
        <h1 className="text-ink text-3xl font-semibold tracking-tight sm:text-4xl">Developers</h1>
        <p className="text-muted text-sm leading-relaxed sm:text-base">
          Five public JSON endpoints over the published NAV documents and the contract logs of{" "}
          {TOKEN.symbol}, plus a machine-readable description of all of them. No key, no signup, no
          rate-limit tier: they are read-only, take no credentials and answer cross-origin. The
          schemas below are generated from the same definitions the routes validate their responses
          against, so this page cannot describe a shape the API does not return.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={OPENAPI_ROUTE}
            prefetch={false}
            className="text-accent-ink text-sm font-medium underline underline-offset-4"
          >
            {OPENAPI_ROUTE}
          </Link>
          <span className="text-muted text-sm">— the OpenAPI 3.1 document, served raw.</span>
        </div>
      </header>

      <Alert tone="warning">
        <AlertTitle>This is a test network</AlertTitle>
        <AlertDescription>
          The only chains this project runs on are Base Sepolia ({SUPPORTED_CHAIN_IDS[0]}) and a
          local Anvil ({SUPPORTED_CHAIN_IDS[1]}); this deployment is reading {ACTIVE_CHAIN.label}{" "}
          (chain {ACTIVE_CHAIN.id}). There is no mainnet deployment and no mainnet address anywhere
          in the repository. The portfolio the numbers value is simulated, the attestor is
          simulated, and every document says so in its own <code className="addr">source_note</code>
          . Nothing here prices an asset you can hold.
        </AlertDescription>
      </Alert>

      <section className="flex flex-col gap-4" aria-labelledby="conventions">
        <h2 id="conventions" className="text-ink text-xl font-semibold tracking-tight">
          Four things to know before you start
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle as="h3">Everything is wrapped</CardTitle>
              <CardDescription>
                Success and failure share one envelope, so one parser reads every endpoint.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <CodeBlock code={exampleSuccess} label="Success" />
              <CodeBlock code={exampleError} label="Failure" />
              <p className="text-muted text-sm leading-relaxed">
                <code className="addr text-ink">error.code</code> comes from a closed set, so you
                can switch on it; <code className="addr text-ink">message</code> says what went
                wrong and <code className="addr text-ink">hint</code> says what to do about it. Both
                are always present. The one exception to the envelope is{" "}
                <code className="addr text-ink">{OPENAPI_ROUTE}</code>, which serves the OpenAPI
                document itself — a generator pointed at that URL expects a document, not an
                envelope containing one.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h3">Money is never a JSON number</CardTitle>
              <CardDescription>
                A fixed-scale decimal string for display, the integer beside it to compute with.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm leading-relaxed">
              <p className="text-muted">
                Every amount arrives as a decimal <strong className="text-ink">string</strong> with
                a fixed number of fractional digits — two for USD totals, six for per-token amounts
                and USDC, eighteen for token amounts — and, wherever a contract or the engine holds
                the underlying integer, as that <strong className="text-ink">integer</strong> beside
                it. <code className="addr text-ink">usdc_6dec</code> and{" "}
                <code className="addr text-ink">*_usdc_6dec</code> are six-decimal USDC integers;{" "}
                <code className="addr text-ink">*_wei</code> and{" "}
                <code className="addr text-ink">*_1e18</code> are 18-decimal integers, written as
                decimal strings where a JSON number would lose their low digits.
              </p>
              <p className="text-muted">
                Parse the integer with <code className="addr text-ink">BigInt</code> and format at
                the edge. Parse neither into a float: the fixed scale on the string is exactly what
                makes an exact decimal parse safe. Yields, durations and convexities <em>are</em>{" "}
                JSON numbers — they are analytics, not money.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h3">Caching and CORS</CardTitle>
              <CardDescription>What every response here actually carries.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm leading-relaxed">
              <p className="text-muted">
                Success:{" "}
                <code className="addr text-ink">Cache-Control: {PUBLIC_CACHE_CONTROL}</code>. A
                poller hits a CDN rather than a function, and the last good answer stays in front of
                readers while a refresh happens behind them. The NAV documents change once a day.
              </p>
              <p className="text-muted">
                Failure: <code className="addr text-ink">Cache-Control: no-store</code>. A transient
                RPC failure must not be served for a minute.
              </p>
              <p className="text-muted">
                Both: <code className="addr text-ink">Access-Control-Allow-Origin: *</code>. These
                endpoints are public, read-only and take no credentials, so a browser on any origin
                may read them.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h3">Generate a client</CardTitle>
              <CardDescription>
                The description is an OpenAPI 3.1 document with named components.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <CodeBlock
                code={`npx openapi-typescript ${baseUrl}${OPENAPI_ROUTE} -o hitbite-api.d.ts`}
                label="Generate TypeScript types"
                caption="Any OpenAPI 3.1 generator works; this is simply the shortest one to demonstrate."
              />
              <p className="text-muted text-sm leading-relaxed">
                Unions are discriminated on <code className="addr text-ink">status</code> with an
                explicit mapping, so a generator produces a tagged union rather than an untyped
                object. The shared pieces — <code className="addr text-ink">ChainEvent</code>,{" "}
                <code className="addr text-ink">IndexCoverage</code>,{" "}
                <code className="addr text-ink">NavBlock</code> — are named components rather than
                repeated inline.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="endpoints">
        <h2 id="endpoints" className="text-ink text-xl font-semibold tracking-tight">
          Endpoints
        </h2>
        <nav aria-label="Endpoints" className="flex flex-wrap gap-2">
          {ENDPOINTS.map((endpoint) => (
            <Link
              key={endpoint.path}
              href={`#${endpointAnchor(endpoint)}`}
              className="border-border bg-surface text-ink addr hover:bg-surface-sunken rounded-md border px-2.5 py-1 text-xs"
            >
              {endpoint.path}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-5">
          {ENDPOINTS.map((endpoint) => (
            <EndpointCard
              key={endpoint.path}
              endpoint={endpoint}
              document={document}
              baseUrl={baseUrl}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="on-chain">
        <h2 id="on-chain" className="text-ink text-xl font-semibold tracking-tight">
          On-chain reads
        </h2>
        <ContractReads />
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="elsewhere">
        <h2 id="elsewhere" className="text-ink text-xl font-semibold tracking-tight">
          What is not here
        </h2>
        <Card data-testid="undocumented-routes">
          <CardHeader>
            <CardTitle as="h3">Routes outside the public description</CardTitle>
            <CardDescription>
              These exist and answer, and they are deliberately not part of the integration surface.
              Saying so is more useful than letting someone find them and guess.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {UNDOCUMENTED_ROUTES.map((route) => (
              <div key={route.path} className="flex flex-col gap-1">
                <code className="addr text-ink text-sm">{route.path}</code>
                <p className="text-muted text-sm leading-relaxed">{route.reason}</p>
              </div>
            ))}
            {UNDOCUMENTED_ROUTE_PREFIXES.map((namespace) => (
              <div key={namespace.prefix} className="flex flex-col gap-1">
                <code className="addr text-ink text-sm">{namespace.prefix}*</code>
                <p className="text-muted text-sm leading-relaxed">{namespace.reason}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-testid="partner-guide">
          <CardHeader>
            <CardTitle as="h3">The integration narrative</CardTitle>
            <CardDescription>
              This page is the reference. <code className="addr">{PARTNER_GUIDE_PATH}</code> is the
              argument.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm leading-relaxed">
            <p className="text-muted">
              <code className="addr text-ink">{PARTNER_GUIDE_PATH}</code>, in the repository root,
              is written for a vault curator or an exchange listing team: what the transfer
              restrictions do to an omnibus wallet, how to check that the published NAV and the
              on-chain NAV agree, what a valid attestation signature proves and what it does not,
              the full event table, and how to size a haircut against{" "}
              <code className="addr text-ink">availableLiquidity()</code> rather than against
              notional. It is not reproduced here, because two copies of an argument drift apart and
              the one on the page is always the stale one.
            </p>
            <p className="text-muted">
              Contract sources, the deployment records and the ABIs live in the same repository
              under <code className="addr text-ink">contracts/</code>.
            </p>
          </CardContent>
        </Card>
      </section>
    </Container>
  );
}
