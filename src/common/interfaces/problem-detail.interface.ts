export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  message: string;
  traceId: string;
  errors?: Array<{ path: string; message: string }>;
}
