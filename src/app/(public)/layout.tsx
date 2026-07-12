import type { ReactNode } from "react";

import { PublicFooter } from "@/components/layout/public-footer";
import { PublicHeader } from "@/components/layout/public-header";

export default function PublicLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="public-shell">
      <PublicHeader />
      {children}
      <PublicFooter />
    </div>
  );
}
