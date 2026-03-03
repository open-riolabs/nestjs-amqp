import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Agent } from "https";
import { JwtHeader, JwtPayload, SigningKeyCallback, verify } from "jsonwebtoken";
import { JwksClient } from "jwks-rsa";
import { HandlerAuthConfig } from "../../broker/config/handler-auth.config";
import { RLB_AMQP_AUTH_OPTIONS } from "../../broker/const";

@Injectable()
export class JwtService implements OnModuleInit {

  private readonly jwksClients: { [name: string]: JwksClient; };
  private readonly logger: Logger;

  constructor(@Inject(RLB_AMQP_AUTH_OPTIONS) private readonly authConfig: HandlerAuthConfig[]) {
    this.logger = new Logger(JwtService.name);
    this.jwksClients = {};
  }

  onModuleInit() {
    for (const authConfig of this.authConfig) {
      if (authConfig.type === "jwks") {
        this.jwksClients[authConfig.name] = new JwksClient({
          jwksUri: authConfig.jwksUri,
          cache: true,
          rateLimit: true,
          jwksRequestsPerMinute: 10,
          requestAgent: new Agent({ rejectUnauthorized: false })
        });
      }
    }
  }

  verifyTokenJwks<T = JwtPayload>(authConfig: HandlerAuthConfig, token: string): Promise<T | undefined> {
    if (!authConfig) {
      this.logger.warn("No auth config provided for JWT verification");
      return Promise.resolve(undefined);
    }
    if (!this.jwksClients[authConfig.name]) {
      this.logger.warn(`No jwks client found for ${authConfig.name}`);
      return Promise.resolve(undefined);
    }

    return new Promise((resolve, reject) => {
      if (!token) {
        this.logger.warn("No token provided for JWT verification");
        resolve(undefined);
      }

      verify(token,
        (header: JwtHeader, callback: SigningKeyCallback) => {
          this.jwksClients[authConfig.name].getSigningKey(header.kid, (err, key) => {
            if (err) {
              this.logger.error(`[JWKS] [${authConfig.name}] Error getting signing key`, err);
              callback(err);
            } else {
              const signingKey = key.getPublicKey();
              callback(null, signingKey);
            }
          });
        },
        {
          issuer: authConfig.issuer,
          audience: authConfig.audience,
          algorithms: authConfig.algorithms as any
        },
        (err, decoded) => {
          if (err) {
            resolve(undefined);
            return;
          }
          resolve(decoded as T);
        });
    });
  }

  verifyTokenSecret<T = JwtPayload>(authConfig: HandlerAuthConfig, token: string): Promise<T | undefined> {
    if (!authConfig) {
      return Promise.resolve(undefined);
    }

    return new Promise((resolve, reject) => {
      if (!token) {
        resolve(undefined);
      }

      verify(token,
        authConfig.secret,
        {
          issuer: authConfig.issuer,
          audience: authConfig.audience,
          algorithms: authConfig.algorithms as any
        },
        (err, decoded) => {
          if (err) {
            resolve(undefined);
            return;
          }
          resolve(decoded as T);
        });
    });
  }
}
