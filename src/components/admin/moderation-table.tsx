import type { ReactNode } from "react";

type Column<Row> = { key: keyof Row & string; label: string; render?: (row: Row) => ReactNode };

export function ModerationTable<Row extends { id: string }>({
  caption, columns, rows, emptyKind = "queue", renderActions,
}: {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  emptyKind?: "queue" | "filter";
  renderActions?: (row: Row) => ReactNode;
}) {
  if (!rows.length) return <section className="admin-empty"><h2>{emptyKind === "queue" ? "当前队列已经清空" : "没有符合当前筛选的结果"}</h2><p>{emptyKind === "queue" ? "暂时没有需要处理的项目。" : "可以调整筛选条件后再查看。"}</p></section>;
  return <div className="moderation-list">
    <div className="moderation-list__desktop">
      <table><caption>{caption}</caption><thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}{renderActions ? <th scope="col">操作</th> : null}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>{columns.map((column) => <td key={column.key} data-label={column.label}>{column.render ? column.render(row) : String(row[column.key] ?? "—")}</td>)}{renderActions ? <td><div className="admin-row-actions">{renderActions(row)}</div></td> : null}</tr>)}</tbody>
      </table>
    </div>
    <ol className="moderation-list__mobile" aria-label={`${caption}（移动版）`}>
      {rows.map((row) => <li key={row.id}><dl>{columns.map((column) => <div key={column.key}><dt>{column.label}</dt><dd>{column.render ? column.render(row) : String(row[column.key] ?? "—")}</dd></div>)}</dl>{renderActions ? <div className="admin-row-actions">{renderActions(row)}</div> : null}</li>)}
    </ol>
  </div>;
}
