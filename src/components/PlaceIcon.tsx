import { Box, Cloud, Globe, Monitor, Power, Sparkles, type IconProps } from "@/components/icons";
import type { EffectivePlace } from "@/lib/place";

const ICONS = { cloud: Cloud, vm: Box, local: Monitor, browser: Globe, auto: Sparkles, off: Power } as const;

export function PlaceIcon({ place, ...props }: { place: EffectivePlace } & IconProps) {
  const Icon = ICONS[place];
  return <Icon {...props} />;
}
