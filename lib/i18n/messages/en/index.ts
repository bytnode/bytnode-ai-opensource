/* The English words, the reference: every other language has exactly
   these keys (each file is typed on its English one), so a missing or
   misspelt translation is a type error, not a hole on screen. One file per
   part of the app. */
import { common } from "./common";
import { language } from "./language";
import { account } from "./account";
import { chat } from "./chat";
import { widgets } from "./widgets";
import { shell } from "./shell";
import { ui } from "./ui";
import { onboarding } from "./onboarding";
import { settings } from "./settings";
import { plugins } from "./plugins";
import { paperTrading } from "./paperTrading";
import { watchlist } from "./watchlist";
import { dca } from "./dca";
import { portfolio } from "./portfolio";
import { calendar } from "./calendar";
import { alerts } from "./alerts";
import { scheduler } from "./scheduler";

export const en = { common, language, account, chat, widgets, shell, ui, onboarding, settings, plugins, paperTrading, watchlist, dca, portfolio, calendar, alerts, scheduler };

export type Messages = typeof en;
