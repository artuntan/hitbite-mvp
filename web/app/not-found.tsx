import Link from "next/link";

import { Container } from "@/components/layout/container";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { FileQuestion } from "lucide-react";

export const metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <Container width="prose" className="py-16">
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="That page does not exist. Some sections of this demonstration are still being built; the overview always works."
        action={
          <Button asChild variant="primary">
            <Link href="/">Back to the overview</Link>
          </Button>
        }
      />
    </Container>
  );
}
