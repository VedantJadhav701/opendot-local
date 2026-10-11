export type ContextMode = "on" | "off-short" | "off-long";

export const contextMode = (): ContextMode => {
  const v = process.env.DOTS_CONTEXT_ENGINE;
  return v === "off-short" || v === "off-long" ? v : "on";
};

export const clipChars = (m: ContextMode) => (m === "off-short" ? 4000 : m === "off-long" ? 12000 : Infinity);
