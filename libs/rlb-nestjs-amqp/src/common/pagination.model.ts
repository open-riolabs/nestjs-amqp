export interface PaginationModel<T> {
  page: number;
  limit: number;
  total: number;
  data: T[];
}
