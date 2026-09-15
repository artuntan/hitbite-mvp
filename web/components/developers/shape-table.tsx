import * as React from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { summariseComponent, type OpenApiDocument } from "@/lib/openapi";

import { Inline } from "./prose";

interface ShapeTableProps {
  document: OpenApiDocument;
  /** The component to summarise — the `data` member of the response. */
  component: string;
  /** Accessible name of the table. */
  label: string;
}

/**
 * The top-level shape of a response's `data`, read out of the generated schemas.
 *
 * Nothing here is typed out: the field names, their types and their descriptions all come from the
 * same JSON Schema the OpenAPI document publishes, which came from the zod schema the route
 * validates against. Renaming a field in `lib/schemas.ts` renames it on this page.
 *
 * A union is shown as its branches rather than as a merged list of fields. Merging would suggest
 * that a caller can read `document` without first checking `status`, which is the single mistake
 * the discriminated union exists to prevent.
 */
export function ShapeTable({ document: doc, component, label }: ShapeTableProps) {
  const summary = summariseComponent(doc, component);

  if (summary.kind === "union") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-muted text-sm">
          <code className="addr text-ink">data</code> is a union. Switch on{" "}
          <code className="addr text-ink">{summary.propertyName}</code> before reading anything
          else:
        </p>
        <Table aria-label={label}>
          <TableHeader>
            <TableRow>
              <TableHead>{summary.propertyName}</TableHead>
              <TableHead>Then data is</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.branches.map((branch) => (
              <TableRow key={branch.value}>
                <TableCell>
                  <code className="addr text-ink">{JSON.stringify(branch.value)}</code>
                </TableCell>
                <TableCell>
                  <code className="addr text-ink">{branch.component}</code>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>Field</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {summary.fields.map((field) => (
          <TableRow key={field.name}>
            <TableCell className="whitespace-nowrap">
              <code className="addr text-ink">{field.name}</code>
              {field.required ? null : <span className="text-muted text-xs"> (optional)</span>}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <code className="addr text-muted">{field.type}</code>
            </TableCell>
            <TableCell className="text-muted text-sm">
              {field.description === null ? "—" : <Inline text={field.description} />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
