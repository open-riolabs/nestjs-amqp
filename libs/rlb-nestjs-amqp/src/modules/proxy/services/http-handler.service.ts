import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { Request, Response } from "express";
import * as multer from 'multer';
import { BrokerService } from "../../broker";
import { RLB_AMQP_APP_OPTIONS, RLB_AMQP_GATEWAY_OPTIONS } from "../../broker/const";
import { AppConfig, UtilsService } from "../../broker/services/utils.service";
import { GatewayConfig, PathDefinition } from "../config/path-definition.config";
import { HttpAuthHandlerService } from "./http-auth-handler.service";

@Injectable()
export class HttpHandlerService implements OnModuleInit {

  private server: ExpressAdapter;

  private readonly logger: Logger;
  private readonly multer: multer.Multer;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly broker: BrokerService,
    private readonly utils: UtilsService,
    private readonly httpAuthHandlerService: HttpAuthHandlerService,
    @Inject(RLB_AMQP_APP_OPTIONS) private readonly appConfig: AppConfig,
    @Inject(RLB_AMQP_GATEWAY_OPTIONS) private readonly gatewayConfig: GatewayConfig,
  ) {
    this.logger = new Logger(HttpHandlerService.name);
    this.multer = multer({
      storage: multer.memoryStorage(),
    });
  }

  async onModuleInit() {
    this.server = this.httpAdapterHost.httpAdapter.getInstance<ExpressAdapter>();
    const extPath: PathDefinition[] = [];
    if (this.gatewayConfig.loadConfig?.paths) {
      const o = await this.broker.requestData(this.gatewayConfig.loadConfig.paths.topic, this.gatewayConfig.loadConfig.paths.action, {});
      extPath.push(...o);
    }
    const paths = [...this.gatewayConfig?.paths || [], ...extPath];
    for (const path of paths) {
      this.registerPath(path);
    }
  }

  registerPath(path: PathDefinition) {
    if (!path.method) throw new Error("Method is required for path definition");
    if (!path.path) throw new Error("Path is required for path definition");
    if (!path.topic) throw new Error("Topic is required for path definition");
    if (!path.mode) throw new Error("Mode is required for path definition");

    this.server[path.method.toLowerCase()](path.path, this.multer.any(), async (req: Request, res: Response) => {
      const authData = await this.httpAuthHandlerService.processAuthData(req, path);

      if (path.auth && !authData?.success && path.allowAnonymous !== true) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      if (!(await this.httpAuthHandlerService.checkRoles(authData, path))) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      const httpHeaders = this.httpHeaders(req, path);

      let data = req[path.dataSource] || req.body || {};
      if (path.dataSource === 'body') {
        data = { ...req.params, ...(req.body || {}) };
      } else if (path.dataSource === 'query') {
        data = { ...req.params, ...(req.query || {}) };
      } else if (path.dataSource === 'params') {
        data = req.params || {};
      } else if (path.dataSource === 'body-query') {
        data = { ...req.params, ...(req.query || {}), ...(req.body || {}) };
      } else if (path.dataSource === 'query-body') {
        data = { ...req.params, ...(req.body || {}), ...(req.query || {}) };
      } else {
        data = { ...req.params, ...(req.body || {}), ...(req.query || {}) };
      }
      if (path.parseRaw) {
        Object.assign(data, { $raw: (req as any).rawBody });
      }
      if (req.files) {
        Object.assign(data, { $files: req.files });
      }
      Object.assign(data, req.params);
      if (data['$files']) {
        for (const file of data['$files']) {
          const o: Buffer = file.buffer;
          file.buffer = o.toString('binary');
        }
      }
      const headers = new Map<string, string | string[] | number>();
      if (path.headers) {
        for (const key in path.headers) {
          headers.set(key, path.headers[key]);
        }
      }
      try {
        if (path.mode === "event") {
          this.broker.publishMessage(path.topic, path.action, data, { ...authData, ...httpHeaders, "X-GTW-METHOD": req.method, "X-GTW-PATH": path.path });
          res.status(path.successStatusCode || 202).setHeaders(headers).end();
          this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | PROCESSED 'EVENT'`);
        } else if (path.mode === "rpc") {
          try {
            const resp = await this.broker.requestData(path.topic, path.action, data, { ...authData, ...httpHeaders, "X-GTW-METHOD": req.method, "X-GTW-PATH": path.path }, path.timeout);
            if (resp) {
              if (path.redirect) {
                res.redirect(path.redirect, resp);
                this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | REDIRECT '${path.redirect}'`);
                return;
              }
              if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
              if (headers.get("Content-Type").toString().includes('json')) {
                res.status(path.successStatusCode || 200).setHeaders(headers).json(resp);
                this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | PROCESSED 'JSON'`);
                return;
              }
              if (path.binary) {
                res.status(path.successStatusCode || 200).setHeaders(headers).end(Buffer.from(resp.toString(), 'base64'));
              } else {
                res.status(path.successStatusCode || 200).setHeaders(headers).end(resp);
              }
              this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | PROCESSED 'RAW'`);
              return;
            }
            res.status(path.successStatusCode || 204).end();
            this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | PROCESSED 'NO CONTENT'`);
            return;
          } catch (error) {
            switch (error.name) {
              case "BadRequestError": res.status(400).json(this.utils.error2Object(error, this.appConfig.environment !== 'production')); break;
              case "ForbiddenError": res.status(403).json(this.utils.error2Object(error, this.appConfig.environment !== 'production')); break;
              case "InvalidParamsErrror": res.status(400).json(this.utils.error2Object(error, this.appConfig.environment !== 'production')); break;
              case "NotFoundError": res.status(404).json(this.utils.error2Object(error, this.appConfig.environment !== 'production')); break;
              case "UnauthorizedError": res.status(401).json(this.utils.error2Object(error, this.appConfig.environment !== 'production')); break;
              default: res.status(500).json(this.utils.error2Object(error, this.appConfig.environment !== 'production')); break;
            }
            this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | ERROR '${error.name}' ${error.message}`);
          }
        }
        else {
          throw new Error(`Invalid mode '${path.mode}' for path definition`);
        }
      } catch (error) {
        if (this.appConfig.environment === "development") {
          this.logger.error(error.message);
          res.status(500).json(error);
        }
        else {
          res.status(500).json({ message: "Internal server error", name: error.name });
        }
      }
    });
  }

  private httpHeaders(req: Request, path: PathDefinition): { [k: string]: string | string[] | number; } {
    const data: { [k: string]: string | string[] | number; } = {};
    if (path.forwardHeaders) {
      for (const key in path.forwardHeaders) {
        const header = path.forwardHeaders[key]?.toLocaleLowerCase().trim();
        const headerValue = Object.keys(req.headers).find(h => h.toLowerCase().trim() === header);
        if (headerValue) {
          if (this.gatewayConfig.headerPrefix) {
            data[`${this.gatewayConfig.headerPrefix}${key}`] = req.headers[headerValue];
          } else {
            data[`${key}`] = req.headers[headerValue];
          }
        }
      }
    }
    return data;
  }
}

