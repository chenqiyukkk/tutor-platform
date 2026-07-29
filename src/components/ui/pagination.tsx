import Link from "next/link";

type PaginationProps = {
  currentPage: number;
  getHref?: (page: number) => string;
  totalPages: number;
};

type PageToken = number | "ellipsis";

function getPageTokens(currentPage: number, totalPages: number): PageToken[] {
  const visiblePages = Array.from(
    new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages]),
  )
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);

  return visiblePages.flatMap((page, index) => {
    const previousPage = visiblePages[index - 1];

    return previousPage && page - previousPage > 1
      ? ["ellipsis" as const, page]
      : [page];
  });
}

export function Pagination({
  currentPage,
  getHref = (page) => `?page=${page}`,
  totalPages,
}: PaginationProps) {
  const normalizedTotalPages = Number.isFinite(totalPages)
    ? Math.max(0, Math.trunc(totalPages))
    : 0;

  if (normalizedTotalPages <= 1) return null;

  const normalizedCurrentPage = Number.isFinite(currentPage)
    ? Math.trunc(currentPage)
    : 1;
  const safeCurrentPage = Math.min(
    normalizedTotalPages,
    Math.max(1, normalizedCurrentPage),
  );
  const pageTokens = getPageTokens(safeCurrentPage, normalizedTotalPages);

  return (
    <nav className="pagination" aria-label="分页">
      {safeCurrentPage > 1 ? (
        <Link href={getHref(safeCurrentPage - 1)}>上一页</Link>
      ) : (
        <span aria-disabled="true">上一页</span>
      )}
      <ol>
        {pageTokens.map((token, index) => (
          <li key={token === "ellipsis" ? `ellipsis-${index}` : token}>
            {token === "ellipsis" ? (
              <span className="pagination__ellipsis" aria-hidden="true">
                …
              </span>
            ) : (
              <Link
                href={getHref(token)}
                aria-current={token === safeCurrentPage ? "page" : undefined}
                aria-label={`第 ${token} 页`}
              >
                {token}
              </Link>
            )}
          </li>
        ))}
      </ol>
      {safeCurrentPage < normalizedTotalPages ? (
        <Link href={getHref(safeCurrentPage + 1)}>下一页</Link>
      ) : (
        <span aria-disabled="true">下一页</span>
      )}
    </nav>
  );
}
