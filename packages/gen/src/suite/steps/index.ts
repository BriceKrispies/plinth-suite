import type { SeedStep } from "../seed";
import { groups, members, openingBalances, preferences, program, roles, servicePrincipals } from "./people";
import { catalogueStep } from "./catalogue";
import { badgesStep } from "./badges";
import { segmentsStep } from "./segments";
import { reportingStep } from "./reporting";
import { promotionsStep } from "./promotions";
import { automationsStep } from "./automations";
import { contentStep } from "./content";
import { pagesStep } from "./pages";
import { activityStep } from "./activity";

/**
 * The seed in order. A step may rely on every step before it. People, roles, groups and the ledger opening balances are
 * implemented; the domain steps are hooks that the domain builders fill, one file each.
 */
export const ALL_STEPS: ReadonlyArray<SeedStep> = [
  servicePrincipals,
  members,
  program,
  roles,
  preferences,
  groups,
  openingBalances,
  catalogueStep,
  badgesStep,
  segmentsStep,
  reportingStep,
  promotionsStep,
  automationsStep,
  contentStep,
  pagesStep,
  activityStep,
];
