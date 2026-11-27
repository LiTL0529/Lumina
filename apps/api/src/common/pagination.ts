export interface PageQuery {
  page?: string | number;
  pageSize?: string | number;
}

export interface ParsedPagination {
  enabled: boolean;
  page: number;
  pageSize: number;
  skip: number;
}

export function parsePagination(
  q?: PageQuery,
  defaultPageSize = 20,
  maxPageSize = 200,
): ParsedPagination {
  const enabled =
    (q?.page !== undefined && q?.page !== null && String(q.page).trim() !== '') ||
    (q?.pageSize !== undefined && q?.pageSize !== null && String(q.pageSize).trim() !== '');
  const rawPage = Number(q?.page ?? 1);
  const rawSize = Number(q?.pageSize ?? defaultPageSize);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize =
    Number.isFinite(rawSize) && rawSize >= 1
      ? Math.min(maxPageSize, Math.floor(rawSize))
      : defaultPageSize;
  return {
    enabled,
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  };
}

export function paginateArray<T>(all: T[], q?: PageQuery, defaultPageSize = 20) {
  const pg = parsePagination(q, defaultPageSize);
  if (!pg.enabled) return all;
  return {
    items: all.slice(pg.skip, pg.skip + pg.pageSize),
    total: all.length,
    page: pg.page,
    pageSize: pg.pageSize,
  };
}
