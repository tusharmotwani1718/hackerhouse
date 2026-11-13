/** Display names for the 12 skills (enum values from the API). */
export const SKILL_LABELS: Record<string, string> = {
  FRONTEND: "Frontend",
  BACKEND: "Backend",
  MOBILE: "Mobile",
  AI_ML: "AI / ML",
  DATA: "Data",
  DEVOPS_CLOUD: "DevOps / Cloud",
  UI_UX_DESIGN: "UI / UX",
  PRODUCT: "Product",
  BLOCKCHAIN: "Blockchain",
  SECURITY: "Security",
  HARDWARE_IOT: "Hardware / IoT",
  GAME_DEV: "Game dev",
};

export const skillLabel = (skill: string) => SKILL_LABELS[skill] ?? skill;
