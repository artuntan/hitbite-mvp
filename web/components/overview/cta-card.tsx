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
 * `NAV_ITEMS` is the shell's single source of truth for routes that exist; a
 * page's entry moves into it in the same commit that ships the page. Reading it
 * here means each control below becomes a real link the moment its page lands,
 * and stays an explained, `aria-disabled` control until then — never a 404
 * either way (BUILD_PROMPT 16.5, "no dead links").
 */
const TRANSPARENCY = NAV_ITEMS.find((item) => item.href === "/transparency");

function isBuilt(href: string): boolean {
  return NAV_ITEMS.some((item) => item.href === href);
}

const FLOW_IS_BUILT = FLOW_STEPS.every((step) => isBuilt(step.href));

/** Call to action toward verification and subscription. */
export function CtaCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Verify, then subscribe</CardTitle>
        <CardDescription id="cta-availability">
          {FLOW_IS_BUILT
            ? "Two steps on this test network, with no money at stake. Verification is auto-approved by a simulated registrar and asks for no identity document; the USDC comes from a faucet."
            : "Part of the investor flow is not in this build yet. Until it ships, those controls are inactive on purpose rather than pointing at a page that does not exist."}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <ul className="grid gap-4 sm:grid-cols-2">
          {FLOW_STEPS.map((step) => {
            const built = isBuilt(step.href);
            const phase = phaseFor(step.href);
            return (
              <li
                key={step.href}
                className="border-border bg-surface-sunken flex flex-col gap-3 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {built ? (
                    <Button variant="secondary" size="sm" asChild>
                      <Link href={step.href}>{step.title}</Link>
                    </Button>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
                <p className="text-muted text-sm leading-relaxed">{step.description}</p>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-3">
          <p className="text-muted text-sm leading-relaxed">
            You can also read the published NAV and holdings straight from the{" "}
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
