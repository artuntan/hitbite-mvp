import type { Metadata } from "next";

import { DocumentPage } from "@/components/content/document-page";
import { loadContentDocument } from "@/components/content/source";
import { TESTNET_NOTICE_SHORT } from "@/lib/copy";

/**
 * `/rules` — BUILD_PROMPT 7.2: "Compliance rules. Human-readable explanation of whitelist, blocked
 * countries, transfer restrictions, pause, NAV rail; pulled from `COMPLIANCE_RULES.md`."
 *
 * Pulled, not paraphrased. The page renders the canonical document (PLAN.md D12) with the design
 * system's typography: linkable headings, tables through the `ui/table` primitives, code spans in
 * IBM Plex Mono naming the actual Solidity errors. If a rule changes, it changes in
 * `COMPLIANCE_RULES.md` and this page follows in the same commit — there is no second copy of the
 * wording to forget.
 *
 * A **public server component**. It imports the markdown parser, the table primitives and nothing
 * else; no wagmi, no RainbowKit, no `lib/wagmi.ts` (PLAN.md D63). `force-static` because the only
 * input is a committed file: the page is rendered once during `next build` and no request ever
 * reads the filesystem.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Compliance rules",
  description: `Every rule the hbTRS contracts enforce on-chain — the whitelist, blocked countries, transfer restrictions, coupons, the NAV rail, pause, input bounds and roles — rendered from COMPLIANCE_RULES.md, the canonical document in the repository. ${TESTNET_NOTICE_SHORT}`,
};

export default function RulesPage() {
  return <DocumentPage loaded={loadContentDocument("compliance-rules")} />;
}
