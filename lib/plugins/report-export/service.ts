import type { Written, WriteInput } from "./write";

/* What the report export offers the plugins that use it (the portfolio,
   the paper trading): the same standalone document, from their view's
   "Export" button. */
export type ReportService = {
  write(input: WriteInput): Promise<Written>;
};
