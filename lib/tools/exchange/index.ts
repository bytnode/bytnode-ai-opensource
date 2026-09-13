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

/* Les dix outils exchange. Un agent ne les recoit que s'il a au moins un
   compte rattache (`registry.ts`, `finance-server.ts`). */
export const exchangeTools = (): Tool[] =>
  [balanceTool, positionsTool, ordersTool, tickerTool, watchTool, placeOrderTool, cancelOrderTool, closePositionTool, transferTool, setLeverageTool] as Tool[];
