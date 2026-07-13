import type { DirectoryCircleTier } from "@/features/directory/circle";

const labels: Record<DirectoryCircleTier, string> = {
  SAME_DISTRICT: "同区匹配",
  ADJACENT_DISTRICT: "邻区匹配",
  ONLINE: "线上匹配",
};

export function CircleRibbon({ tier }: { tier?: DirectoryCircleTier }) {
  return tier ? (
    <span className={`circle-ribbon circle-ribbon--${tier.toLowerCase()}`}>{labels[tier]}</span>
  ) : (
    <span className="circle-ribbon circle-ribbon--guest">登录后可查看你的地区圈层</span>
  );
}
