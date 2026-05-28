export interface StandardResponse<T> {
  data: T;
  meta?: {
    total?: number;
    cursor?: string;
    limit?: number;
  };
  traceId: string;
}
