import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpAdapterHost } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { Request, Response } from "express";
import { JwtService } from "./jwt.service";
import { AppConfig } from "@rlb/nestjs-core";
import { GatewayConfig, PathDefinition } from "@rlb/nestjs-core";
import { BrokerService } from "../../broker";

const ROLES_CLAIM = "roles";

@Injectable()
export class HttpHandlerService implements OnModuleInit {

  private server: ExpressAdapter;
  private readonly gatewayConfig: GatewayConfig
  private readonly appConfig: AppConfig
  private readonly logger: Logger

  constructor(
    private readonly configService: ConfigService,
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly broker: BrokerService,
    private readonly jwtService: JwtService
  ) {
    this.gatewayConfig = this.configService.get<GatewayConfig>("gateway");
    this.appConfig = this.configService.get<AppConfig>("app");
    this.logger = new Logger(HttpHandlerService.name);
  }

  onModuleInit() {
    this.server = this.httpAdapterHost.httpAdapter.getInstance<ExpressAdapter>();
    for (const path of this.gatewayConfig?.paths || []) {
      this.registerPath(path);
    }
  }

  registerPath(path: PathDefinition) {
    if (!path.method) throw new Error("Method is required for path definition");
    if (!path.path) throw new Error("Path is required for path definition");
    if (!path.topic) throw new Error("Topic is required for path definition");
    if (!path.mode) throw new Error("Mode is required for path definition");

    this.server[path.method.toLowerCase()](path.path, async (req: Request, res: Response) => {
      this.logger.debug(`Processing [${path.method.toUpperCase()}] '${path.path}' => [${path.mode.toUpperCase()}] ${path.topic}`);
      const data = req[path.dataSource];

      if (path.auth) {
        const jwt = req.headers.authorization?.split(" ")[1];
        const decoded = await this.jwtService.verifyToken(jwt);
        if (!decoded) {
          res.status(401).json({ message: "Unauthorized" });
          return;
        } else {
          if (path.roles && path.roles.length > 0) {
            const userRoles = decoded[ROLES_CLAIM] || [];
            const hasRole = path.roles.some(role => userRoles.includes(role));
            if (!hasRole) {
              res.status(403).json({ message: "Forbidden" });
              return;
            }
          }
        }
      }
      Object.assign(data, req.params, { _method: req.method, _path: path.path });
      try {
        if (path.mode === "event") {
          this.broker.publishMessage(path.topic, data);
          res.status(202).end();
          this.logger.debug(`Published event for topic ${path.topic}`);
        } else if (path.mode === "rpc") {
          try {
            const resp = await this.broker.requestData(path.topic, path.action, data);
            if (resp) {
              res.status(200).json(resp);
            } else {
              res.status(204).end();
            }
            this.logger.debug(`RPC response processed for topic ${path.topic}`);
          } catch (error) {
            switch (error.name) {
              case "BadRequestError": res.status(400).json({ message: error.message, name: error.name, stack: error.stack }); break;
              case "ForbiddenError": res.status(403).json({ message: error.message, name: error.name, stack: error.stack }); break;
              case "InvalidParamsErrror": res.status(400).json({ message: error.message, name: error.name, stack: error.stack }); break;
              case "NotFoundError": res.status(404).json({ message: error.message, name: error.name, stack: error.stack }); break;
              case "UnauthorizedError": res.status(401).json({ message: error.message, name: error.name, stack: error.stack }); break;
              default: res.status(500).json({ message: error.message, name: error.name, stack: error.stack }); break;
            }
            this.logger.debug(`RPC error for topic ${path.topic}`);
          }
        }
        else {
          throw new Error(`Invalid mode '${path.mode}' for path definition`);
        }
      } catch (error) {
        if (this.appConfig.environment === "development") {
          this.logger.error(error.message);
          res.status(500).json(error)
        }
        else {
          res.status(500).json({ message: "Internal server error", name: error.name });
        }
      }
    });
  }
}
