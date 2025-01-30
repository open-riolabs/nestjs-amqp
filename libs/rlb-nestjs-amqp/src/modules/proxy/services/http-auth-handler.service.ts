import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PathDefinition } from '@sicilyaction/lib-nestjs-core';
import { HandlerAuthConfig } from '../../broker/config/handler-auth.config';
import { Request, Response } from 'express';
import { JwtService } from './jwt.service';

@Injectable()
export class HttpAuthHandlerService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService) {
    this.authConfig = this.configService.get<HandlerAuthConfig>('auth');
  }

  private readonly authConfig: HandlerAuthConfig;

  async processAuthData(req: Request, path: PathDefinition): Promise<{ [key: string]: any; }> {
    let decoded: any;
    let out: { [key: string]: any; } = {};
    const jwt = req.headers.authorization?.split(" ")[1];
    if (this.authConfig.jwtSignMode === 'secret') {
      decoded = await this.jwtService.verifyTokenSecret(jwt);
    }
    if (this.authConfig.jwtSignMode === 'jwks') {
      decoded = await this.jwtService.verifyTokenJwks(jwt);
    }
    if (!decoded && path.auth) {
      return undefined;
    } else {
      if (!this.authConfig.jwtMap) {
        out = decoded;
      } else {
        this.authConfig.jwtMap.map(o => o.split(':')).forEach(([source, dest]) => {
          if (decoded?.[source])
            out[`${this.authConfig.headerPrefix}${dest.trim().toUpperCase()}`] = decoded?.[source];
        });
      }
      return out;
    }
  }

  checkRoles(data: { [key: string]: any; }, path: PathDefinition): boolean {
    if (!path?.auth) return true;
    if (!path?.roles) return true;
    if (!data) return false;

    const roles: string[] = data[this.authConfig.rolesClaim];
    if (!roles) return false;
    if (path.roles.all && path.roles.some) throw new Error("Path definition can't have both 'all' and 'some' roles");
    if (path.roles.all) return path.roles.all.every((role: string) => roles.includes(role));
    if (path.roles.some) return path.roles.some.some((role: string) => roles.includes(role));
  }
}
