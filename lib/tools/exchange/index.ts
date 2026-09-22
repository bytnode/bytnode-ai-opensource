import type { Tool } from "../types";
import { balanceTool } from "./balance";
import { positionsTool } from "./positions";
import { ordersTool } from "./orders";
import { tickerTool } from "./ticker";
import { watchTool } from "./watch";
import { placeOrderTool } from "./place-order";
import { cancelOrderTool } from "./cancel-order";
import { closePositionTool } from "./close-position";
import { transferTool } from "./transfer";
import { setLeverageTool } from "./set-leverage";

/* The ten exchange tools. An agent only receives them if it has at least
   one attached account (`registry.ts`, `finance-server.ts`). */
export const exchangeTools = (): Tool[] =>
  [balanceTool, positionsTool, ordersTool, tickerTool, watchTool, placeOrderTool, cancelOrderTool, closePositionTool, transferTool, setLeverageTool] as Tool[];
