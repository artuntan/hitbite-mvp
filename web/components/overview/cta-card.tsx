import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS, PLANNED_ROUTES } from "@/components/layout/nav-items";

const FLOW_STEPS = [
  {
    href: "/verify",
    title: "Verify your wallet",
    description:
      "Name, country and a professional-investor attestation. On this testnet the request is auto-approved by a registrar worker; in production a partner's KYC vendor does it.",
  },
  {
    href: "/subscribe",
    title: "Subscribe in test USDC",
    description:
      "Mint MockUSDC from the faucet, approve the token contract, then subscribe at the current NAV.",
  },
] as const;

function phaseFor(href: string): string | null {
  return PLANNED_ROUTES.find((route) => route.href === href)?.phase ?? null;
}

/**
 * `NAV_ITEMS` is the shell's single source of truth for routes that exist; the
 * convention is that a page's entry moves out of `PLANNED_ROUTES` and into it in
 * the same commit that ships the page. Reading it here means this card links to
 * the transparency page the moment that page lands, and silently omits the link
 * until then — never a 404 either way.
 */
const TRANSPARENCY = NAV_ITEMS.find((item) => item.href === "/transparency");

/**
 * Call to action toward verification and subscription.
 *
 * Neither /verify nor /subscribe exists in this build, so neither is linked: a
 * 404 from the Overview is worse than an honest "not yet" (BUILD_PROMPT 16.5,
 * "no dead links"). Those two controls are `aria-disabled` rather than removed —
 * still focusable, announced as unavailable, and explained in text right beside
 * them. Every link that is rendered points at a route that exists today.
 */
export function CtaCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Verify, then subscribe</CardTitle>
        <CardDescription id="cta-availability">
          The investor flow is not part of this build yet. Until it ships, these controls are
          inactive on purpose rather than pointing at a page that does not exist.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <ul className="grid gap-4 sm:grid-cols-2">
          {FLOW_STEPS.map((step) => {
            const phase = phaseFor(step.href);
            return (
              <li
                key={step.href}
                className="border-border bg-surface-sunken flex flex-col gap-3 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-disabled="true"
                    aria-describedby="cta-availability"
                    className="cursor-not-allowed opacity-60"
                  >
                    {step.title}
                  </Button>
                  <StatusBadge tone="neutral">{phase ?? "Not built yet"}</StatusBadge>
                </div>
                <p className="text-muted text-sm leading-relaxed">{step.description}</p>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-3">
          <p className="text-muted text-sm leading-relaxed">
            What you can do today: read the published NAV and holdings through the{" "}
            <a
              href="/api/nav"
              className="text-accent-ink underline underline-offset-4 hover:no-underline"
            >
              public JSON API
            </a>
            , which serves the same documents this page renders. Nothing on this network has any
            monetary value.
          </p>

          {TRANSPARENCY ? (
            <div>
              <Button variant="primary" size="md" asChild>
                <Link href={TRANSPARENCY.href}>Check the numbers on {TRANSPARENCY.label}</Link>
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
