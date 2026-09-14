import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTimeUtc } from "@/lib/format";

interface DataProvenanceProps {
  /** `source_note` from nav.json — the engine's own description of what it computed. */
  sourceNote: string;
  generatedAt: string;
}

/** Endpoints that exist today. Anything not built yet is not linked from here. */
const ENDPOINTS = [
  {
    href: "/api/nav",
    label: "/api/nav",
    description: "NAV, portfolio analytics, fees, chain state",
  },
  {
    href: "/api/holdings",
    label: "/api/holdings",
    description: "Every position, cash and fees payable",
  },
  {
    href: "/api/stats",
    label: "/api/stats",
    description: "The above plus the full NAV history series",
  },
] as const;

/**
 * Where the numbers on this page come from, in the engine's own words, and the
 * public endpoints that serve exactly the same documents.
 */
export function DataProvenance({ sourceNote, generatedAt }: DataProvenanceProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">What the engine computed</CardTitle>
        <CardDescription>
          Written by the NAV engine at{" "}
          <time dateTime={generatedAt} className="num">
            {formatDateTimeUtc(generatedAt)}
          </time>
          . Every figure on this page is formatted from the 6-decimal integers in these documents,
          so the page, the API and the token contract round identically.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <p className="text-muted max-w-3xl text-sm leading-relaxed">{sourceNote}</p>

        <div className="flex flex-col gap-2">
          <h4 className="text-muted text-xs font-semibold tracking-wide uppercase">
            Read the same data
          </h4>
          <ul className="flex flex-col gap-1.5">
            {ENDPOINTS.map((endpoint) => (
              <li key={endpoint.href} className="text-sm">
                <a
                  href={endpoint.href}
                  className="text-accent-ink addr underline underline-offset-4 hover:no-underline"
                >
                  {endpoint.label}
                </a>
                <span className="text-muted"> — {endpoint.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
