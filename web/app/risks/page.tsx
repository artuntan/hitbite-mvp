import type { Metadata } from "next";

import { DocumentPage } from "@/components/content/document-page";
import { loadContentDocument } from "@/components/content/source";
import { TESTNET_NOTICE_SHORT } from "@/lib/copy";

/**
 * `/risks` — BUILD_PROMPT 7.2: "Risks. Plain-language product and bond risks from `RISKS.md`."
 *
 * The same treatment as `/rules` (PLAN.md D12): the canonical document, rendered, with nothing
 * softened on the way through. A risk page is the one page where a summary is a disservice — the
 * document opens by saying that none of this is real yet and then says what would be true of the
 * real product, and both halves have to reach the reader in the author's words.
 *
 * A **public server component**, `force-static`, with no wallet imports (PLAN.md D63).
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Risks",
  description: `What is simulated, the risks in the bonds themselves, the risks in the structure, regulatory risk and technology risk — rendered from RISKS.md, the canonical document in the repository. ${TESTNET_NOTICE_SHORT}`,
};

export default function RisksPage() {
  return <DocumentPage loaded={loadContentDocument("risks")} />;
}
