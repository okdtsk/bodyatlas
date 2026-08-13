/**
 * Single mapping from semantic role to Phosphor glyph. Screens import from here,
 * never from '@phosphor-icons/react' directly, so a glyph swap is a one-line change
 * and the whole app cannot drift onto two icon families.
 *
 * Sizing convention: 24 in tabs, 20 inline, 28 on the FAB.
 * Weight convention: "fill" when active or selected, "bold" otherwise.
 */
export {
  CalendarBlank as IconToday,
  Barbell as IconTrain,
  ForkKnife as IconHealth,
  ChartLineUp as IconTrends,
  GearSix as IconSettings,
  Barbell as IconSet,
  ForkKnife as IconMeal,
  Scales as IconWeight,
  Moon as IconSleep,
  Plus as IconPlus,
  Check as IconCheck,
  X as IconClose,
  CaretLeft as IconPrev,
  CaretRight as IconNext,
  CaretUp as IconMoveUp,
  CaretDown as IconMoveDown,
  Sparkle as IconSparkle,
  Star as IconStar,
  TrendUp as IconTrendUp,
  TrendDown as IconTrendDown,
  PencilSimple as IconEdit,
} from '@phosphor-icons/react';
