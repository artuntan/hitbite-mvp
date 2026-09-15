import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { curlFor, type EndpointDoc, type OpenApiDocument } from "@/lib/openapi";

import { CodeBlock } from "./code-block";
import { Inline, Prose } from "./prose";
import { ShapeTable } from "./shape-table";

interface EndpointCardProps {
  endpoint: EndpointDoc;
  document: OpenApiDocument;
  /** The origin serving this page, so the `curl` below can be pasted and run. */
  baseUrl: string;
}

/** `/api/nav` → `api-nav`, so the heading has a stable anchor to link to. */
export function endpointAnchor(endpoint: EndpointDoc): string {
  return endpoint.path.replace(/^\//, "").replaceAll(/[^a-zA-Z0-9]+/g, "-");
}

/**
 * One endpoint: what it answers, what it takes, what comes back, and a `curl` that runs.
 *
 * Everything on the card comes from `lib/openapi.ts` — the same model that builds the document
 * `/api/openapi.json` serves — so the page and the machine-readable description cannot disagree
 * about a parameter, a status code or a cache header.
 */
export function EndpointCard({ endpoint, document: doc, baseUrl }: EndpointCardProps) {
  const anchor = endpointAnchor(endpoint);
  return (
    <Card id={anchor} className="scroll-mt-20" data-testid={`endpoint-${anchor}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">GET</Badge>
          <CardTitle as="h3" className="addr text-base">
            {endpoint.path}
          </CardTitle>
        </div>
        <CardDescription>{endpoint.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <Prose text={endpoint.description} />
          {endpoint.notes.length > 0 ? (
            <ul className="text-muted flex list-disc flex-col gap-1.5 pl-5 text-sm">
              {endpoint.notes.map((note) => (
                <li key={note}>
                  <Inline text={note} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {endpoint.parameters.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h4 className="text-ink text-sm font-semibold">Query parameters</h4>
            <Table aria-label={`Query parameters for GET ${endpoint.path}`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>What it does</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoint.parameters.map((parameter) => (
                  <TableRow key={parameter.name}>
                    <TableCell className="whitespace-nowrap">
                      <code className="addr text-ink">{parameter.name}</code>
                    </TableCell>
                    <TableCell className="text-muted text-sm">{parameter.defaultNote}</TableCell>
                    <TableCell className="text-muted text-sm">
                      <Inline text={parameter.description} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : null}

        {endpoint.dataComponent ? (
          <section className="flex flex-col gap-2">
            <h4 className="text-ink text-sm font-semibold">
              Response — <code className="addr">{"{ ok: true, data }"}</code>, where{" "}
              <code className="addr">data</code> is{" "}
              <code className="addr">{endpoint.dataComponent}</code>
            </h4>
            <ShapeTable
              document={doc}
              component={endpoint.dataComponent}
              label={`Response fields of GET ${endpoint.path}`}
            />
          </section>
        ) : null}

        {endpoint.failures.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h4 className="text-ink text-sm font-semibold">When it fails</h4>
            <Table aria-label={`Failure responses of GET ${endpoint.path}`}>
              <TableHeader>
                <TableRow>
                  <TableHead numeric>HTTP</TableHead>
                  <TableHead>error.code</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoint.failures.map((failure) => (
                  <TableRow key={`${failure.status.toString()}-${failure.code}`}>
                    <TableCell numeric>{failure.status}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <code className="addr text-ink">{failure.code}</code>
                    </TableCell>
                    <TableCell className="text-muted text-sm">
                      <Inline text={failure.when} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : null}

        <Separator />

        <CodeBlock
          code={curlFor(endpoint, baseUrl)}
          label={`curl for GET ${endpoint.path}`}
          caption={endpoint.curlNote}
        />

        <p className="text-muted text-xs">
          Sent with <code className="addr text-ink">Cache-Control: {endpoint.cacheControl}</code> on
          success
          {endpoint.failures.length > 0 ? (
            <>
              {" "}
              and <code className="addr text-ink">Cache-Control: no-store</code> on failure
            </>
          ) : null}
          , and <code className="addr text-ink">Access-Control-Allow-Origin: *</code>.
        </p>
      </CardContent>
    </Card>
  );
}
