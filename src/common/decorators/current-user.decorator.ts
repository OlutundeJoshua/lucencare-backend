import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as JwtPayload;
  },
);
