import Link from "next/link";

type PaginationProps = {
  currentPage: number;
  getHref?: (page: number) => string;
  totalPages: number;
};

export function Pagination({
  currentPage,
  getHref = (page) => `?page=${page}`,
  totalPages,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <nav className="pagination" aria-label="分页">
      {currentPage > 1 ? (
        <Link href={getHref(currentPage - 1)}>上一页</Link>
      ) : (
        <span aria-disabled="true">上一页</span>
      )}
      <ol>
        {pages.map((page) => (
          <li key={page}>
            <Link
              href={getHref(page)}
              aria-current={page === currentPage ? "page" : undefined}
              aria-label={`第 ${page} 页`}
            >
              {page}
            </Link>
          </li>
        ))}
      </ol>
      {currentPage < totalPages ? (
        <Link href={getHref(currentPage + 1)}>下一页</Link>
      ) : (
        <span aria-disabled="true">下一页</span>
      )}
    </nav>
  );
}
