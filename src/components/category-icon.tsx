import {
  Construction,
  CookingPot,
  Drill,
  Hammer,
  Package,
  Sprout,
  SprayCan,
  Tent,
  type LucideIcon,
} from "lucide-react";
import { cn } from "./ui";

const ICONS: Record<string, LucideIcon> = {
  power_tools: Drill,
  hand_tools: Hammer,
  garden: Sprout,
  kitchen: CookingPot,
  camping: Tent,
  cleaning: SprayCan,
  ladders: Construction,
  other: Package,
};

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = ICONS[category] ?? Package;
  return <Icon className={cn("size-4", className)} aria-hidden />;
}

/** Rounded tile with the category icon, used on cards. */
export function CategoryTile({ category, size = "md" }: { category: string; size?: "sm" | "md" }) {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-xl bg-brand-soft text-brand",
        size === "sm" ? "size-9" : "size-11",
      )}
    >
      <CategoryIcon category={category} className={size === "sm" ? "size-4" : "size-5"} />
    </div>
  );
}
