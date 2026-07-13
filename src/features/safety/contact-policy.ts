export const contactPolicyMessage = "请勿填写联系方式、外部链接或付费引导";

const contactPatterns = [
  /(?:微\s*信|微\s*xin|wei\s*xin|we\s*chat|wechat|weixin|v\s*信)/iu,
  /(?:^|[^A-Za-z0-9])(?:w\s*x|v\s*x)(?=\s*(?:号|id|[:：])|\s+[\p{L}\p{N}_-]{2,}|$)/iu,
  /(?:^|[^a-z])q\s*q(?:[^a-z]|$)/iu,
  /扣\s*扣/iu,
  /(?:whats?\s*app|w\s*h\s*a\s*t\s*s\s*a\s*p\s*p)/iu,
  /tele\s*gram/iu,
  /(?:^|[^a-z0-9])t\s*g(?=\s*(?:号|id|[:：@])|\s+[\p{L}\p{N}_-]{2,}|$)/iu,
  /二\s*维\s*码|扫码/iu,
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/iu,
  /(?:https?:\/\/|www\.)\S+/iu,
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/iu,
  /(?:加\s*好友|付\s*(?:信息|中介)\s*费|外部\s*付费|转账)/iu,
  /(?:联系\s*方式|手机号|手机号码|电话号|邮箱|私聊发|座机)/iu,
];

export function normalizeContactText(value: string) {
  return value.normalize("NFKC").replace(/\p{Cf}/gu, "");
}

export function violatesContactPolicy(value: string | null | undefined) {
  if (!value) return false;
  const normalized = normalizeContactText(value);
  const compactPhoneCandidate = normalized.replace(/[\s./()\-_,，、•·:：]/gu, "");
  const hasMobile = /(?:^|[^\d])(?:\+?86)?1[3-9]\d{9}(?:$|[^\d])/u.test(compactPhoneCandidate);
  const hasLandline = /(?:^|[^\d])(?:\+?86)?0\d{9,11}(?:$|[^\d])/u.test(compactPhoneCandidate);
  return hasMobile || hasLandline || contactPatterns.some((pattern) => pattern.test(normalized));
}
