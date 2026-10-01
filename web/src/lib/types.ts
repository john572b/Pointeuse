// Types de réponse dérivés directement du serveur (source unique de vérité).
import type { dashboard, dayViews, stats } from "../../../server/services/overview";
import type { publicUser } from "../../../server/services/data";

export type User = ReturnType<typeof publicUser>;
export type Dashboard = ReturnType<typeof dashboard>;
export type DaysResponse = ReturnType<typeof dayViews>;
export type DayView = DaysResponse["days"][number];
export type StatsResponse = ReturnType<typeof stats>;
export type { PayLine, Anomaly } from "@shared/pay/engine";
export type { PayRules, Bonus } from "@shared/pay/rules";
export type Shift = DayView["shifts"][number];
