export function formatDirectoryDate(value: string | Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
