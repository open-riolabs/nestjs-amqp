import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { JwksClient } from "jwks-rsa";
import { JwtHeader, JwtPayload, SigningKeyCallback, verify } from "jsonwebtoken";
import { ConfigService } from "@nestjs/config";
import { Agent } from "https";
import { HandlerAuthConfig } from "../../broker/config/handler-auth.config";

@Injectable()
export class JwtService implements OnModuleInit {

  private readonly jwksClients: { [name: string]: JwksClient };
  private authConfig: HandlerAuthConfig[];
  private readonly logger: Logger;

  constructor(private readonly configService: ConfigService) {
    this.logger = new Logger(JwtService.name);
    this.jwksClients = {};
  }

  onModuleInit() {
    this.authConfig = this.configService.get<HandlerAuthConfig[]>("auth-providers");
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
      this.logger.debug(`Auth config not found`);
      return Promise.resolve(undefined);
    }
    if (!this.jwksClients[authConfig.name]) {
      this.logger.debug(`No jwks client found for ${authConfig.name}`);
      return Promise.resolve(undefined);
    }

    return new Promise((resolve, reject) => {
      if (!token) {
        this.logger.debug("No token provided");
        resolve(undefined);
      }

      verify(token,
        (header: JwtHeader, callback: SigningKeyCallback) => {
          this.jwksClients[authConfig.name].getSigningKey(header.kid, (err, key) => {
            if (err) {
              this.logger.debug("Error getting signing key", err);
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
            this.logger.debug("Error verifying token", err);
            resolve(undefined);
            return;
          }
          resolve(decoded as T);
        });
    });
  }

  verifyTokenSecret<T = JwtPayload>(authConfig: HandlerAuthConfig, token: string): Promise<T | undefined> {
    if (!authConfig) {
      this.logger.debug(`Auth config not found`);
      return Promise.resolve(undefined);
    }

    return new Promise((resolve, reject) => {
      if (!token) {
        this.logger.debug("No token provided");
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
